import "server-only";

import { formatConductorName } from "@/modules/territories/names";
import { ApiError } from "@/server/api";
import type { AdminSupabase } from "@/server/outings/planning";
import { territoryLabels } from "@/server/territories/rounds";

export type TestEntry = { id: string; territory_number: number; conductor: string; assigned_on: string; completed_on: string | null };

export async function listTestEntries(supabase: AdminSupabase): Promise<{ entries: TestEntry[]; conductors: { id: string; name: string }[] }> {
  const [rounds, profiles] = await Promise.all([
    supabase.from("territory_rounds").select("id, assigned_on, completed_on, territories(number), profiles!conductor_id(full_name)").eq("is_test", true).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  if (rounds.error) throw new Error(rounds.error.message);
  if (profiles.error) throw new Error(profiles.error.message);
  const one = <T,>(value: T | T[] | null) => (Array.isArray(value) ? value[0] : value) ?? null;
  return {
    entries: (rounds.data ?? []).map((round) => ({
      id: round.id as string,
      territory_number: (one(round.territories as { number: number } | { number: number }[] | null)?.number ?? 0) as number,
      conductor: formatConductorName(one(round.profiles as { full_name: string } | { full_name: string }[] | null)?.full_name),
      assigned_on: round.assigned_on as string,
      completed_on: (round.completed_on as string | null) ?? null,
    })),
    conductors: (profiles.data ?? []).map((profile) => ({ id: profile.id as string, name: formatConductorName(profile.full_name as string) })),
  };
}

/** Creates a flagged round through the same path the real form uses; a completed one carries a single visit that did every block. */
export async function createTestEntry(supabase: AdminSupabase, input: { territory_number: number; conductor_id: string; assigned_on: string; completed_on: string | null }) {
  if (input.completed_on && input.completed_on < input.assigned_on) throw new ApiError("La fecha de completado no puede ser anterior a la asignada.", 400);
  const { data: territory, error } = await supabase.from("territories").select("id").eq("number", input.territory_number).maybeSingle();
  if (error) throw new Error(error.message);
  if (!territory) throw new ApiError("Ese territorio no existe.", 404);
  const territoryId = territory.id as string;

  if (!input.completed_on) {
    const { data: open } = await supabase.from("territory_rounds").select("id").eq("territory_id", territoryId).is("completed_on", null).maybeSingle();
    if (open) throw new ApiError("El territorio ya tiene una vuelta abierta: cargá la de prueba con fecha de completado o cerrá la real primero.", 409);
  }

  const labels = await territoryLabels(supabase, territoryId);
  const { data, error: insertError } = await supabase
    .from("territory_rounds")
    .insert({ territory_id: territoryId, conductor_id: input.conductor_id, assigned_on: input.assigned_on, completed_on: input.completed_on, pending_block_labels: input.completed_on ? [] : labels, done_block_labels: input.completed_on ? labels : [], is_test: true })
    .select("id")
    .single();
  if (insertError?.code === "23505") throw new ApiError("El territorio ya tiene una vuelta abierta.", 409);
  if (insertError || !data) throw new Error(insertError?.message ?? "No se pudo crear la entrada de prueba.");

  if (input.completed_on) {
    const { error: visitError } = await supabase.from("territory_visits").insert({ territory_round_id: data.id, conductor_id: input.conductor_id, visit_date: input.completed_on, done_labels: labels, pending_labels: [], planned: false });
    if (visitError) {
      await supabase.from("territory_rounds").delete().eq("id", data.id);
      throw new Error(visitError.message);
    }
  }
  return { id: data.id as string };
}

/** Only rows created by the test form (is_test) can be removed here; real rounds are never touched. */
export async function deleteTestEntry(supabase: AdminSupabase, id: string) {
  const { data, error } = await supabase.from("territory_rounds").select("id, is_test").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ApiError("Entrada no encontrada.", 404);
  if (!data.is_test) throw new ApiError("Solo se pueden borrar entradas de prueba.", 403);
  const visits = await supabase.from("territory_visits").delete().eq("territory_round_id", id);
  if (visits.error) throw new Error(visits.error.message);
  const round = await supabase.from("territory_rounds").delete().eq("id", id).eq("is_test", true);
  if (round.error) throw new Error(round.error.message);
  return { deleted: true };
}
