import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { personalModes } from "@/modules/personal/period";
import { phoneActivities } from "@/modules/telephone/assignment";
import { forbid, handle, parseBody, requireProfile } from "@/server/api";
import { createAssignment, endAssignment, listForManagers, loadMine, submitPersonalReport } from "@/server/personal";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), payload: z.object({ profile_id: z.string().uuid(), territory_id: z.string().uuid(), mode: z.enum(personalModes), assigned_on: z.string().date() }) }),
  z.object({ action: z.literal("end"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({
    action: z.literal("submitReport"),
    payload: z.object({
      assignment_id: z.string().uuid(),
      notes: z.string().max(2000).nullable().optional(),
      done_labels: z.array(z.string().min(1).max(40)).max(200).optional(),
      results: z.array(z.object({ phone_number_id: z.string().uuid(), activity: z.enum(phoneActivities) })).max(500).optional(),
    }),
  }),
]);

export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const supabase = createAdminSupabaseClient();
    const mine = await loadMine(supabase, profile);
    const canManage = (await getTerritoryAccess(profile)).canManage;
    return { ...mine, canManage, manage: canManage ? await listForManagers(supabase) : null };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();
    if (action === "submitReport") return submitPersonalReport(supabase, profile, payload);
    if (!(await getTerritoryAccess(profile)).canManage) forbid("Solo Superintendente de Servicio o Siervo de Territorios asignan territorios personales.");
    return action === "create" ? createAssignment(supabase, profile, payload) : endAssignment(supabase, profile, payload.id);
  });
}
