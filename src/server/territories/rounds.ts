import "server-only";

import { derivePendingByVisit, sortVisits, summarizeRound } from "@/modules/territories/rounds";
import type { AdminSupabase } from "@/server/outings/planning";

/** Active block labels of a territory, in display order. */
export async function territoryLabels(supabase: AdminSupabase, territoryId: string): Promise<string[]> {
  const { data, error } = await supabase.from("blocks").select("label").eq("territory_id", territoryId).eq("active", true).order("label");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.label as string);
}

/**
 * Rebuilds a round from its visits (S-13 rules in modules/territories/rounds.ts).
 * `derive` recalculates each visit's pending blocks from what was done so far; the legacy
 * form sends explicit pending blocks, so it keeps them untouched (`derive: false`).
 * Returns an error message, or null on success.
 */
export async function recomputeRound(supabase: AdminSupabase, roundId: string, options: { derive: boolean }): Promise<string | null> {
  const { data, error } = await supabase.from("territory_visits").select("id, visit_date, conductor_id, done_labels, pending_labels, created_at").eq("territory_round_id", roundId);
  if (error) return error.message;
  if (!data?.length) {
    const { error: deleteError } = await supabase.from("territory_rounds").delete().eq("id", roundId);
    return deleteError?.message ?? null;
  }

  let visits = sortVisits(data);
  if (options.derive) {
    const { data: round, error: roundError } = await supabase.from("territory_rounds").select("territory_id").eq("id", roundId).single();
    if (roundError || !round) return roundError?.message ?? "Vuelta no encontrada.";
    const labels = await territoryLabels(supabase, round.territory_id as string);
    const pending = derivePendingByVisit(labels, visits);
    for (const [index, visit] of visits.entries()) {
      if (JSON.stringify(visit.pending_labels) === JSON.stringify(pending[index])) continue;
      const { error: updateError } = await supabase.from("territory_visits").update({ pending_labels: pending[index], updated_at: new Date().toISOString() }).eq("id", visit.id);
      if (updateError) return updateError.message;
    }
    visits = visits.map((visit, index) => ({ ...visit, pending_labels: pending[index] }));
  }

  const summary = summarizeRound(visits);
  if (!summary) return null;
  const { error: updateError } = await supabase.from("territory_rounds").update({ ...summary, updated_at: new Date().toISOString() }).eq("id", roundId);
  return updateError?.message ?? null;
}
