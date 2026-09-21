import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { formatConductorName } from "@/modules/territories/names";
import { PHONE_MINIMUM, isPhoneActivity, selectTerritoriesForPhoneOuting, type PhoneActivity, type PhoneTerritory } from "@/modules/telephone/assignment";
import { formatDateEs } from "@/modules/outings/time";
import type { PlanningAuthority } from "@/modules/outings/workflow";
import { ApiError, forbid } from "@/server/api";
import { loadWeek, resolvePlannerIds, safeEmit, writeAudit, type AdminSupabase } from "@/server/outings/planning";

/** Territories with their active phone count and most recent worked date (the telephone "age"). */
export async function phoneTerritories(supabase: AdminSupabase): Promise<PhoneTerritory[]> {
  const [territories, numbers] = await Promise.all([
    supabase.from("territories").select("id, number").eq("active", true).order("number"),
    supabase.from("territory_phone_numbers").select("territory_id, last_activity_on").eq("active", true),
  ]);
  for (const result of [territories, numbers]) if (result.error) throw new Error(result.error.message);
  const stats = new Map<string, { count: number; last: string | null }>();
  for (const row of numbers.data ?? []) {
    const current = stats.get(row.territory_id as string) ?? { count: 0, last: null };
    const date = (row.last_activity_on as string | null) ?? null;
    stats.set(row.territory_id as string, { count: current.count + 1, last: date && (!current.last || date > current.last) ? date : current.last });
  }
  return (territories.data ?? []).map((territory) => ({ id: territory.id as string, number: territory.number as number, phone_count: stats.get(territory.id as string)?.count ?? 0, last_activity_on: stats.get(territory.id as string)?.last ?? null }));
}

/**
 * Computes and STORES the number list for one Zoom outing (snapshot). Re-running replaces it,
 * so a later change to the phone list never alters what an outing was already given.
 */
export async function assignPhoneNumbers(supabase: AdminSupabase, input: { slotId: string; primaryTerritoryId: string; actorId: string }) {
  const territories = await phoneTerritories(supabase);
  const selection = selectTerritoriesForPhoneOuting(input.primaryTerritoryId, territories, PHONE_MINIMUM);
  const { data: numbers, error } = selection.territory_ids.length
    ? await supabase.from("territory_phone_numbers").select("id, territory_id, number").in("territory_id", selection.territory_ids).eq("active", true)
    : { data: [], error: null };
  if (error) throw new Error(error.message);

  const order = new Map(selection.territory_ids.map((id, index) => [id, index]));
  const sorted = [...(numbers ?? [])].sort((a, b) => (order.get(a.territory_id as string) ?? 0) - (order.get(b.territory_id as string) ?? 0) || String(a.number).localeCompare(String(b.number)));

  const cleared = await supabase.from("telephone_assignments").delete().eq("slot_id", input.slotId);
  if (cleared.error) throw new Error(cleared.error.message);
  const { data: assignment, error: assignmentError } = await supabase
    .from("telephone_assignments")
    .insert({ slot_id: input.slotId, primary_territory_id: input.primaryTerritoryId, territory_ids: selection.territory_ids, total: sorted.length, minimum: PHONE_MINIMUM, created_by: input.actorId })
    .select("id")
    .single();
  if (assignmentError || !assignment) throw new Error(assignmentError?.message ?? "No se pudo guardar el listado telefónico.");
  if (sorted.length) {
    const { error: rowsError } = await supabase.from("telephone_assignment_numbers").insert(sorted.map((row, index) => ({ assignment_id: assignment.id, phone_number_id: row.id, territory_id: row.territory_id, sort_order: index, snapshot_number: row.number })));
    if (rowsError) throw new Error(rowsError.message);
  }
  return { assignmentId: assignment.id as string, territory_ids: selection.territory_ids, total: sorted.length };
}

export type PhoneBlock = {
  assignment_id: string;
  total: number;
  done: number;
  called_on: string | null;
  numbers: { phone_number_id: string; number: string; territory_number: number | string; activity: PhoneActivity | null; previous_activity: PhoneActivity | null; last_activity_on: string | null }[];
};

/** Assigned numbers + results already recorded, for every Zoom slot in `slotIds`. */
export async function loadPhoneBlocks(supabase: AdminSupabase, slotIds: string[]): Promise<Map<string, PhoneBlock>> {
  const blocks = new Map<string, PhoneBlock>();
  if (!slotIds.length) return blocks;
  const { data: assignments, error } = await supabase.from("telephone_assignments").select("id, slot_id, total").in("slot_id", slotIds);
  if (error) throw new Error(error.message);
  if (!assignments?.length) return blocks;
  const assignmentIds = assignments.map((assignment) => assignment.id as string);
  const [assigned, results] = await Promise.all([
    supabase.from("telephone_assignment_numbers").select("assignment_id, phone_number_id, sort_order, snapshot_number, territories(number), territory_phone_numbers(activity, last_activity_on)").in("assignment_id", assignmentIds).order("sort_order"),
    supabase.from("telephone_call_results").select("slot_id, phone_number_id, activity, called_on").in("slot_id", slotIds),
  ]);
  for (const result of [assigned, results]) if (result.error) throw new Error(result.error.message);
  const resultKey = new Map((results.data ?? []).map((row) => [`${row.slot_id}:${row.phone_number_id}`, row]));

  for (const assignment of assignments) {
    const numbers = (assigned.data ?? []).filter((row) => row.assignment_id === assignment.id).map((row) => {
      const territory = Array.isArray(row.territories) ? row.territories[0] : row.territories;
      const phone = Array.isArray(row.territory_phone_numbers) ? row.territory_phone_numbers[0] : row.territory_phone_numbers;
      const result = resultKey.get(`${assignment.slot_id}:${row.phone_number_id}`);
      return {
        phone_number_id: row.phone_number_id as string,
        number: row.snapshot_number as string,
        territory_number: (territory as { number?: number } | null)?.number ?? "?",
        activity: result && isPhoneActivity(result.activity) ? result.activity : null,
        previous_activity: isPhoneActivity((phone as { activity?: string } | null)?.activity) ? ((phone as { activity: PhoneActivity }).activity) : null,
        last_activity_on: (phone as { last_activity_on?: string | null } | null)?.last_activity_on ?? null,
      };
    });
    const calledOn = (results.data ?? []).filter((row) => row.slot_id === assignment.slot_id).map((row) => row.called_on as string).sort().pop() ?? null;
    blocks.set(assignment.slot_id as string, { assignment_id: assignment.id as string, total: numbers.length, done: numbers.filter((number) => number.activity).length, called_on: calledOn, numbers });
  }
  return blocks;
}

/** "Salida del jueves por Zoom" + the weather text, ready for the announcement composer. */
export function zoomAnnouncementDraft(slotDate: string, hora: string | null) {
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const day = days[new Date(`${slotDate}T00:00:00Z`).getUTCDay()];
  return {
    title: `Salida del ${day} por Zoom`,
    description: `Debido a las condiciones climáticas, la salida del ${day} ${formatDateEs(slotDate).slice(0, 5)}${hora ? ` de las ${hora}` : ""} se realizará mediante Zoom.`,
  };
}

export type ResultsInput = { slot_id: string; called_on?: string | null; results: { phone_number_id: string; activity: PhoneActivity }[] };

/** Records call results: the conductor of the outing (or a planner on their behalf) fills them in quickly. */
export async function saveCallResults(ctx: { supabase: AdminSupabase; profile: SessionProfile; authority: PlanningAuthority }, input: ResultsInput) {
  const { supabase, profile, authority } = ctx;
  const { data: slot, error } = await supabase.from("weekly_outing_slots").select("id, weekly_outing_id, slot_date, conductor_id, status, is_zoom").eq("id", input.slot_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!slot) throw new ApiError("Salida no encontrada.", 404);
  if (!slot.is_zoom) throw new ApiError("Esta salida no es por Zoom.", 409);
  const week = await loadWeek(supabase, slot.weekly_outing_id as string);
  if (!week || week.status !== "PUBLISHED") throw new ApiError("La salida todavía no está publicada.", 409);
  if (slot.status === "CANCELADA") throw new ApiError("La salida fue cancelada.", 409);
  if (!slot.conductor_id) throw new ApiError("La salida no tiene conductor asignado.", 422);
  const onBehalf = slot.conductor_id !== profile.id;
  if (onBehalf && !authority.canPlan && !authority.canPublish) forbid("Solo el conductor de la salida puede cargar los resultados.");

  const calledOn = input.called_on || (slot.slot_date as string);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calledOn)) throw new ApiError("Fecha inválida.", 422);
  const { data: assignment } = await supabase.from("telephone_assignments").select("id").eq("slot_id", slot.id).maybeSingle();
  if (!assignment) throw new ApiError("La salida todavía no tiene un listado telefónico.", 409);
  const { data: assigned, error: assignedError } = await supabase.from("telephone_assignment_numbers").select("phone_number_id").eq("assignment_id", assignment.id);
  if (assignedError) throw new Error(assignedError.message);
  const allowed = new Set((assigned ?? []).map((row) => row.phone_number_id as string));
  if (input.results.some((row) => !allowed.has(row.phone_number_id))) throw new ApiError("Hay números que no pertenecen a esta salida.", 422);

  const now = new Date().toISOString();
  for (const row of input.results) {
    const { error: upsertError } = await supabase.from("telephone_call_results").upsert({ slot_id: slot.id, phone_number_id: row.phone_number_id, conductor_id: slot.conductor_id, activity: row.activity, called_on: calledOn, recorded_by: profile.id, updated_at: now }, { onConflict: "slot_id,phone_number_id" });
    if (upsertError) throw new Error(upsertError.message);
    // The number's current state follows its most recent activity date, never an older edit.
    const { error: stateError } = await supabase.from("territory_phone_numbers").update({ activity: row.activity, last_activity_on: calledOn, last_conductor_id: slot.conductor_id, updated_at: now }).eq("id", row.phone_number_id).or(`last_activity_on.is.null,last_activity_on.lte.${calledOn}`);
    if (stateError) throw new Error(stateError.message);
  }

  const { data: recorded, error: recordedError } = await supabase.from("telephone_call_results").select("phone_number_id").eq("slot_id", slot.id);
  if (recordedError) throw new Error(recordedError.message);
  const complete = allowed.size > 0 && [...allowed].every((id) => (recorded ?? []).some((row) => row.phone_number_id === id));
  await writeAudit(supabase, { actorId: profile.id, action: complete ? "PHONE_RESULTS_COMPLETED" : "PHONE_RESULTS_SAVED", entityType: "weekly_outing_slot", entityId: slot.id, metadata: { slot_date: slot.slot_date, on_behalf: onBehalf, saved: input.results.length, total: allowed.size } });

  if (complete && slot.status === "PROGRAMADA") {
    await supabase.from("weekly_outing_slots").update({ status: "REALIZADA", updated_at: now }).eq("id", slot.id);
    const { data: conductor } = await supabase.from("profiles").select("full_name").eq("id", slot.conductor_id).maybeSingle();
    const title = `${formatConductorName(conductor?.full_name as string | undefined)} completó los resultados telefónicos de la salida del ${formatDateEs(slot.slot_date as string)}.`;
    for (const recipientId of await resolvePlannerIds(supabase)) {
      if (recipientId === profile.id) continue;
      await safeEmit({ type: "VISIT_REPORT_SUBMITTED", naturalKey: `phone-results:${slot.id}:${recipientId}`, actorId: profile.id, payload: { recipientId, reportId: slot.id as string, title, targetUrl: `/?view=myOutings&highlight=${slot.id}` } });
    }
  }
  return { complete, saved: input.results.length };
}
