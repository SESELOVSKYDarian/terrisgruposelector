import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { isValidHora } from "@/modules/outings/recurring";
import { canEditWeek } from "@/modules/outings/workflow";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { materializeTemplate, loadTemplate } from "@/server/outings/recurring";
import { getPlanningAuthority, isEligibleConductor, listConductors, loadWeek, writeAudit } from "@/server/outings/planning";

export const runtime = "nodejs";

const hora = z.string().refine(isValidHora, "Hora inválida (HH:MM).");
const conductorId = z.string().uuid().nullable().optional();
const groupId = z.string().uuid().nullable().optional();

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), payload: z.object({ isodow: z.number().int().min(1).max(7), hora, lugar: z.string().trim().max(180).nullable().optional(), default_conductor_id: conductorId, default_group_id: groupId }) }),
  z.object({
    action: z.literal("update"),
    payload: z.object({ id: z.string().uuid(), isodow: z.number().int().min(1).max(7).optional(), hora: hora.optional(), lugar: z.string().trim().max(180).nullable().optional(), default_conductor_id: conductorId, default_group_id: groupId, active: z.boolean().optional() }),
  }),
  z.object({ action: z.literal("delete"), payload: z.object({ id: z.string().uuid() }) }),
  z.object({ action: z.literal("applyToWeek"), payload: z.object({ weekly_outing_id: z.string().uuid() }) }),
]);

async function requirePlanner() {
  const profile = await requireProfile();
  const authority = await getPlanningAuthority(profile);
  if (!authority.canPlan && !authority.canPublish) forbid("Solo quienes planifican las salidas pueden ver la plantilla semanal.");
  return { profile, authority };
}

export async function GET() {
  return handle(async () => {
    await requirePlanner();
    const supabase = createAdminSupabaseClient();
    const [slots, conductors, groupsResult] = await Promise.all([loadTemplate(supabase), listConductors(supabase), supabase.from("groups").select("id, name").order("name")]);
    const names = new Map(conductors.map((conductor) => [conductor.id, conductor.full_name]));
    const groups = groupsResult.data ?? [];
    const groupNames = new Map(groups.map((group) => [group.id as string, group.name as string]));
    return {
      slots: slots.map((slot) => ({ ...slot, default_group_id: slot.default_group_id ?? null, conductor_name: slot.default_conductor_id ? names.get(slot.default_conductor_id) ?? null : null, group_name: slot.default_group_id ? groupNames.get(slot.default_group_id) ?? null : null })),
      conductors,
      groups,
    };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const { profile, authority } = await requirePlanner();
    const { action, payload } = await parseBody(request, mutation);
    const supabase = createAdminSupabaseClient();

    if (action === "applyToWeek") {
      const week = await loadWeek(supabase, payload.weekly_outing_id);
      if (!week) throw new ApiError("Semana no encontrada.", 404);
      if (!canEditWeek(authority, week.status)) forbid("Esta planificación no se puede editar en su estado actual.");
      const created = await materializeTemplate(supabase, week);
      await writeAudit(supabase, { actorId: profile.id, action: "RECURRING_TEMPLATE_APPLIED", entityType: "weekly_outing", entityId: week.id, metadata: { starts_on: week.starts_on, created } });
      return { created };
    }

    if (action === "delete") {
      const { data: before } = await supabase.from("recurring_outing_slots").select("*").eq("id", payload.id).maybeSingle();
      if (!before) throw new ApiError("Fila de plantilla no encontrada.", 404);
      const { error } = await supabase.from("recurring_outing_slots").delete().eq("id", payload.id);
      if (error) throw new Error(error.message);
      await writeAudit(supabase, { actorId: profile.id, action: "RECURRING_SLOT_DELETED", entityType: "recurring_outing_slot", entityId: payload.id, before });
      return {};
    }

    // Only someone with the CONDUCTOR characteristic may hold the star.
    if (payload.default_conductor_id && !(await isEligibleConductor(supabase, payload.default_conductor_id))) {
      throw new ApiError("El conductor predeterminado debe tener la característica Conductor.", 422);
    }

    if (payload.default_group_id) {
      const { data: group } = await supabase.from("groups").select("id").eq("id", payload.default_group_id).maybeSingle();
      if (!group) throw new ApiError("El grupo no existe.", 422);
    }
    if (payload.default_group_id && payload.default_conductor_id) throw new ApiError("Elegí un conductor o un grupo, no ambos.", 422);

    if (action === "create") {
      const { data, error } = await supabase
        .from("recurring_outing_slots")
        .insert({ isodow: payload.isodow, hora: payload.hora, lugar: payload.lugar || null, default_conductor_id: payload.default_conductor_id ?? null, ...(payload.default_group_id ? { default_group_id: payload.default_group_id } : {}), created_by: profile.id })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "No se pudo crear la fila.");
      await writeAudit(supabase, { actorId: profile.id, action: "RECURRING_SLOT_CREATED", entityType: "recurring_outing_slot", entityId: data.id, after: payload });
      return { id: data.id };
    }

    const { id, ...patch } = payload;
    const { data: before } = await supabase.from("recurring_outing_slots").select("*").eq("id", id).maybeSingle();
    if (!before) throw new ApiError("Fila de plantilla no encontrada.", 404);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.isodow !== undefined) update.isodow = patch.isodow;
    if (patch.hora !== undefined) update.hora = patch.hora;
    if (patch.lugar !== undefined) update.lugar = patch.lugar || null;
    // A row has a conductor or a group, never both: choosing one clears the other.
    if (patch.default_conductor_id !== undefined) update.default_conductor_id = patch.default_conductor_id;
    if (patch.default_group_id !== undefined) update.default_group_id = patch.default_group_id;
    if (patch.default_group_id) update.default_conductor_id = null;
    if (patch.default_conductor_id) update.default_group_id = null;
    if (patch.active !== undefined) update.active = patch.active;
    const { error } = await supabase.from("recurring_outing_slots").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    await writeAudit(supabase, { actorId: profile.id, action: "RECURRING_SLOT_UPDATED", entityType: "recurring_outing_slot", entityId: id, before, after: update });
    return {};
  });
}
