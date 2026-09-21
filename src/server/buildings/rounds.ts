import "server-only";

import { roundProgress, type ActivityRow, type RoundProgress } from "@/modules/buildings/activity";
import { writeAudit, type AdminSupabase } from "@/server/outings/planning";

const ACTIVITY_COLUMNS = "id, unit_id, user_id, attended, interested, outcome, worked_at, next_available_at, revisit_active, undone_at, unlocked_at, round_id";

async function activeUnitsWithHistory(supabase: AdminSupabase, buildingId: string) {
  const { data: units, error } = await supabase.from("building_units").select("id").eq("building_id", buildingId).eq("active", true);
  if (error) throw new Error(error.message);
  const ids = (units ?? []).map((unit) => unit.id as string);
  if (!ids.length) return [];
  const { data: rows, error: activityError } = await supabase.from("building_unit_activity").select(ACTIVITY_COLUMNS).in("unit_id", ids);
  if (activityError) throw new Error(activityError.message);
  return ids.map((id) => ({ id, activities: ((rows ?? []) as ActivityRow[]).filter((row) => row.unit_id === id) }));
}

export async function progressOfRound(supabase: AdminSupabase, buildingId: string, roundId: string, now = new Date()): Promise<RoundProgress> {
  return roundProgress(await activeUnitsWithHistory(supabase, buildingId), roundId, now);
}

/**
 * Closes the open round once every doorbell is done for it (a revisita counts) and opens the
 * next one. Building rounds are independent of the S-13, and temporary locks are properties of
 * the marks themselves, so they keep applying in the new round.
 */
export async function evaluateRound(supabase: AdminSupabase, buildingId: string, actorId: string, now = new Date()): Promise<{ closed: number | null }> {
  const { data: round, error } = await supabase.from("building_rounds").select("id, round_number").eq("building_id", buildingId).is("closed_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!round) return { closed: null };
  const progress = await progressOfRound(supabase, buildingId, round.id as string, now);
  if (!progress.complete) return { closed: null };

  // Conditional update: two concurrent evaluations close (and open the next round) only once.
  const { data: closed, error: closeError } = await supabase.from("building_rounds").update({ closed_at: now.toISOString() }).eq("id", round.id).is("closed_at", null).select("id");
  if (closeError) throw new Error(closeError.message);
  if (!closed?.length) return { closed: null };
  const { error: nextError } = await supabase.from("building_rounds").insert({ building_id: buildingId, round_number: (round.round_number as number) + 1, started_at: now.toISOString() });
  if (nextError && nextError.code !== "23505") throw new Error(nextError.message);
  await writeAudit(supabase, { actorId, action: "BUILDING_ROUND_CLOSED", entityType: "building", entityId: buildingId, metadata: { round_number: round.round_number, next_round: (round.round_number as number) + 1, total: progress.total } });
  return { closed: round.round_number as number };
}

/**
 * After an undo: if a round was closed by the mark that was just undone and nothing has been done
 * in the following round, reopen it (the successor is discarded). If the next round already has
 * marks the closure is left as is and reported, never rewritten silently.
 */
export async function reconsiderClosedRound(supabase: AdminSupabase, buildingId: string, roundId: string | null, actorId: string, now = new Date()): Promise<{ reopened: boolean; blocked: boolean }> {
  if (!roundId) return { reopened: false, blocked: false };
  const { data: round, error } = await supabase.from("building_rounds").select("id, round_number, closed_at").eq("id", roundId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!round?.closed_at) return { reopened: false, blocked: false };
  if ((await progressOfRound(supabase, buildingId, roundId, now)).complete) return { reopened: false, blocked: false };

  const { data: next } = await supabase.from("building_rounds").select("id").eq("building_id", buildingId).eq("round_number", (round.round_number as number) + 1).maybeSingle();
  if (next) {
    const { count } = await supabase.from("building_unit_activity").select("id", { count: "exact", head: true }).eq("round_id", next.id).is("undone_at", null);
    if (count) {
      await writeAudit(supabase, { actorId, action: "BUILDING_ROUND_REOPEN_BLOCKED", entityType: "building", entityId: buildingId, metadata: { round_number: round.round_number, reason: "next round already has activity" } });
      return { reopened: false, blocked: true };
    }
    await supabase.from("building_unit_activity").update({ round_id: null }).eq("round_id", next.id);
    const removed = await supabase.from("building_rounds").delete().eq("id", next.id);
    if (removed.error) throw new Error(removed.error.message);
  }
  const { error: reopenError } = await supabase.from("building_rounds").update({ closed_at: null }).eq("id", roundId);
  if (reopenError) throw new Error(reopenError.message);
  await writeAudit(supabase, { actorId, action: "BUILDING_ROUND_REOPENED", entityType: "building", entityId: buildingId, metadata: { round_number: round.round_number } });
  return { reopened: true, blocked: false };
}

/** Current round progress plus the recent history, for the building header. */
export async function loadRoundSummary(supabase: AdminSupabase, buildingId: string, now = new Date()) {
  const { data, error } = await supabase.from("building_rounds").select("id, round_number, started_at, closed_at").eq("building_id", buildingId).order("round_number", { ascending: false }).limit(8);
  if (error) throw new Error(error.message);
  const rounds = data ?? [];
  const open = rounds.find((round) => !round.closed_at);
  const progress = open ? await progressOfRound(supabase, buildingId, open.id as string, now) : null;
  return {
    current: open ? { round_number: open.round_number as number, started_at: open.started_at as string, ...(progress as RoundProgress) } : null,
    history: rounds.filter((round) => round.closed_at).map((round) => ({ round_number: round.round_number as number, started_at: round.started_at as string, closed_at: round.closed_at as string })),
  };
}
