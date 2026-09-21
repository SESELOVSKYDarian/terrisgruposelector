import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { isWindowOpen } from "@/modules/groups/group-outings";
import { handle, parseBody, requireProfile } from "@/server/api";
import { extendWindowDeadline, groupResponsibles, openGroupOuting, saveGroupResponse } from "@/server/groups/group-outings";
import { getPlanningAuthority, listConductors } from "@/server/outings/planning";

export const runtime = "nodejs";

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const mutation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveResponse"),
    payload: z.object({
      window_id: z.string().uuid(),
      group_id: z.string().uuid(),
      service_date: z.string().date(),
      lugar: z.string().max(400),
      hora: z.string().nullable().optional(),
      conductor_id: z.string().uuid().nullable().optional(),
      territory_ids: z.array(z.string().uuid()).max(20).default([]),
    }),
  }),
  z.object({ action: z.literal("openWindow"), payload: z.object({ saturday_date: z.string().date(), days: z.enum(["SATURDAY", "SUNDAY", "BOTH"]), deadline_local: localDateTime }) }),
  z.object({ action: z.literal("extendDeadline"), payload: z.object({ window_id: z.string().uuid(), deadline_local: localDateTime }) }),
]);

export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const authority = await getPlanningAuthority(profile);
    const isPlanner = authority.canPlan || authority.canPublish;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [windowsResult, groupsResult, territoriesResult] = await Promise.all([
      supabase.from("reservation_windows").select("id,name,saturday_date,sunday_date,booking_deadline,active").eq("active", true).gte("booking_deadline", since).order("booking_deadline", { ascending: false }).limit(12),
      supabase.from("groups").select("id,name").eq("active", true).order("name"),
      supabase.from("territories").select("id,number,name").eq("active", true).order("number"),
    ]);
    for (const result of [windowsResult, groupsResult, territoriesResult]) if (result.error) throw new Error(result.error.message);

    const groups = [];
    for (const group of groupsResult.data ?? []) {
      const responsibles = await groupResponsibles(supabase, group.id);
      // Responsibles see only their own group; planners see every group to follow progress.
      if (!isPlanner && !responsibles.some((person) => person.id === profile.id)) continue;
      groups.push({ ...group, responsibles, conductors: await listConductors(supabase, { groupId: group.id }) });
    }

    const windows = windowsResult.data ?? [];
    const windowIds = windows.map((window) => window.id);
    const responses = windowIds.length ? (await supabase.from("group_outing_responses").select("id,reservation_window_id,group_id,service_date,lugar,hora,conductor_id,completed_by,completed_at,updated_by,updated_at").in("reservation_window_id", windowIds).in("group_id", groups.map((group) => group.id))).data ?? [] : [];
    const responseIds = responses.map((response) => response.id);
    const reservations = windowIds.length ? (await supabase.from("territory_reservations").select("territory_id,service_date,group_id,group_response_id").in("reservation_window_id", windowIds).eq("status", "ACTIVE")).data ?? [] : [];

    return {
      me: profile.id,
      isPlanner,
      windows: windows.map((window) => ({ ...window, open: isWindowOpen(window.booking_deadline) })),
      groups,
      responses: responses.map((response) => ({ ...response, territory_ids: reservations.filter((row) => row.group_response_id === response.id).map((row) => row.territory_id) })),
      territories: territoriesResult.data ?? [],
      taken: reservations.filter((row) => !responseIds.includes(row.group_response_id)).map((row) => ({ territory_id: row.territory_id, service_date: row.service_date, group_id: row.group_id })),
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    const { action, payload } = await parseBody(request, mutation);
    const ctx = { supabase: createAdminSupabaseClient(), profile, authority: await getPlanningAuthority(profile) };
    if (action === "saveResponse") return saveGroupResponse(ctx, payload);
    if (action === "openWindow") return openGroupOuting(ctx, payload);
    return extendWindowDeadline(ctx, payload);
  });
}
