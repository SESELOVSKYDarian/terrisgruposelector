import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { formatConductorName } from "@/modules/territories/names";
import { parsePhoneList } from "@/modules/telephone/assignment";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { importPhoneHistory } from "@/server/telephone/history-import";
import { writeAudit } from "@/server/outings/planning";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addNumbers"), payload: z.object({ territory_id: z.string().uuid(), text: z.string().max(20000) }) }),
  z.object({ action: z.literal("importHistory"), payload: z.object({ text: z.string().max(300000) }) }),
  z.object({ action: z.literal("setZoomDays"), payload: z.object({ days: z.array(z.number().int().min(1).max(7)).max(7), hora: z.string().max(20).nullable() }) }),
  z.object({ action: z.literal("setActive"), payload: z.object({ id: z.string().uuid(), active: z.boolean() }) }),
  z.object({ action: z.literal("delete"), payload: z.object({ id: z.string().uuid() }) }),
]);

async function requireManager() {
  const profile = await requireProfile();
  if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo Superintendente de Servicio o Siervo de Territorios administran el territorio telefónico.");
  return profile;
}

export async function GET() {
  return handle(async () => {
    await requireManager();
    const supabase = createAdminSupabaseClient();
    const [territories, numbers, zoomDays] = await Promise.all([
      supabase.from("territories").select("id, number, name").eq("active", true).order("number"),
      supabase.from("territory_phone_numbers").select("id, territory_id, number, active, activity, last_activity_on, profiles!last_conductor_id(full_name)").order("number"),
      supabase.from("zoom_outing_days").select("iso_weekday, hora").order("iso_weekday"),
    ]);
    for (const result of [territories, numbers, zoomDays]) if (result.error) throw new Error(result.error.message);
    return {
      zoom_days: { days: (zoomDays.data ?? []).map((row) => row.iso_weekday as number), hora: ((zoomDays.data ?? [])[0]?.hora as string | null) ?? null },
      territories: territories.data ?? [],
      numbers: (numbers.data ?? []).map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return { id: row.id, territory_id: row.territory_id, number: row.number, active: row.active, activity: row.activity, last_activity_on: row.last_activity_on, conductor: formatConductorName((profile as { full_name?: string } | null)?.full_name) || null };
      }),
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireManager();
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();

    if (action === "importHistory") {
      const result = await importPhoneHistory(supabase, payload.text);
      await writeAudit(supabase, { actorId: profile.id, action: "PHONE_HISTORY_IMPORTED", entityType: "territory_phone_number", entityId: null, metadata: { created: result.created, updated: result.updated, invalid: result.invalid } });
      return result;
    }
    if (action === "setZoomDays") {
      const days = [...new Set(payload.days)];
      const hora = payload.hora?.trim() || null;
      const cleared = await supabase.from("zoom_outing_days").delete().gte("iso_weekday", 1);
      if (cleared.error) throw new Error(cleared.error.message);
      if (days.length) {
        const { error } = await supabase.from("zoom_outing_days").insert(days.map((day) => ({ iso_weekday: day, hora })));
        if (error) throw new Error(error.message);
      }
      await writeAudit(supabase, { actorId: profile.id, action: "ZOOM_DAYS_CONFIGURED", entityType: "zoom_outing_days", entityId: null, metadata: { days, hora } });
      return { days, hora };
    }
    if (action === "addNumbers") {
      const { data: territory } = await supabase.from("territories").select("id").eq("id", payload.territory_id).eq("active", true).maybeSingle();
      if (!territory) throw new ApiError("Territorio no encontrado.", 404);
      const { data: existing, error: existingError } = await supabase.from("territory_phone_numbers").select("number_key").eq("territory_id", payload.territory_id);
      if (existingError) throw new Error(existingError.message);
      const { accepted, skipped } = parsePhoneList(payload.text, new Set((existing ?? []).map((row) => row.number_key as string)));
      if (accepted.length) {
        const { error } = await supabase.from("territory_phone_numbers").insert(accepted.map((row) => ({ territory_id: payload.territory_id, number: row.number, number_key: row.number_key })));
        if (error) throw new Error(error.message);
        await writeAudit(supabase, { actorId: profile.id, action: "PHONE_NUMBERS_ADDED", entityType: "territory", entityId: payload.territory_id, metadata: { added: accepted.length, skipped: skipped.length } });
      }
      return { added: accepted.length, skipped };
    }

    const { data: before } = await supabase.from("territory_phone_numbers").select("id, territory_id, number, active").eq("id", payload.id).maybeSingle();
    if (!before) throw new ApiError("Número no encontrado.", 404);
    if (action === "delete") {
      const { error } = await supabase.from("territory_phone_numbers").delete().eq("id", payload.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, { actorId: profile.id, action: "PHONE_NUMBER_DELETED", entityType: "territory_phone_number", entityId: payload.id, before });
      return {};
    }
    const { error } = await supabase.from("territory_phone_numbers").update({ active: payload.active, updated_at: new Date().toISOString() }).eq("id", payload.id);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, { actorId: profile.id, action: payload.active ? "PHONE_NUMBER_ACTIVATED" : "PHONE_NUMBER_DEACTIVATED", entityType: "territory_phone_number", entityId: payload.id, before });
    return {};
  });
}
