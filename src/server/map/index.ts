import "server-only";
import { fetchAll } from "@/server/paging";

import { formatConductorName } from "@/modules/territories/names";
import type { TerritoryMapState } from "@/modules/map/geometry";
import type { AdminSupabase } from "@/server/outings/planning";
import { doNotVisitCounts } from "@/server/territories/do-not-visit";

export type MapTerritoryStats = {
  territory_id: string;
  number: number;
  name: string;
  total_blocks: number;
  completed_blocks: number;
  pending_labels: string[];
  state: TerritoryMapState;
  open_round: { conductor: string; assigned_on: string } | null;
  last_completed_on: string | null;
  last_activity_on: string | null;
  /** Filled by later phases (no visitar, edificios) without changing the map contract. */
  do_not_visit: number;
  buildings: number;
};

/**
 * Hover/detail numbers for every active territory. Block progress comes from the chosen annual round
 * (vuelta); the last completion date is the latest one across every round.
 */
export async function loadTerritoryStats(supabase: AdminSupabase, roundId: string | null): Promise<MapTerritoryStats[]> {
  const [territories, blocks, rounds, visits, dnv, buildingRows, roundStatuses, doneStatuses] = await Promise.all([
    supabase.from("territories").select("id, number, name").eq("active", true).order("number"),
    supabase.from("blocks").select("id, territory_id, label").eq("active", true),
    fetchAll((from, to) => supabase.from("territory_rounds").select("id, territory_id, assigned_on, completed_on, pending_block_labels, profiles!conductor_id(full_name)").order("id").range(from, to)),
    fetchAll((from, to) => supabase.from("territory_visits").select("visit_date, territory_rounds!inner(territory_id)").order("id").range(from, to)),
    doNotVisitCounts(supabase).catch(() => new Map<string, number>()),
    supabase.from("buildings").select("territory_id").eq("status", "ACTIVE"),
    roundId ? supabase.from("block_round_statuses").select("block_id, status").eq("annual_round_id", roundId) : Promise.resolve({ data: [], error: null }),
    fetchAll((from, to) => supabase.from("block_round_statuses").select("completed_on, blocks!inner(territory_id)").eq("status", "COMPLETED").not("completed_on", "is", null).order("id").range(from, to)),
  ]);
  for (const result of [territories, blocks, rounds, visits, roundStatuses, doneStatuses]) if (result.error) throw new Error(result.error.message);

  const statusOfBlock = new Map((roundStatuses.data ?? []).map((row) => [row.block_id as string, row.status as string]));
  const lastDone = new Map<string, string>();
  for (const row of doneStatuses.data ?? []) {
    const block = Array.isArray(row.blocks) ? row.blocks[0] : row.blocks;
    const territoryId = (block as { territory_id?: string } | null)?.territory_id;
    if (territoryId && (!lastDone.has(territoryId) || (row.completed_on as string) > lastDone.get(territoryId)!)) lastDone.set(territoryId, row.completed_on as string);
  }

  const blocksByTerritory = new Map<string, { id: string; label: string }[]>();
  for (const block of blocks.data ?? []) blocksByTerritory.set(block.territory_id as string, [...(blocksByTerritory.get(block.territory_id as string) ?? []), { id: block.id as string, label: block.label as string }]);
  const lastVisit = new Map<string, string>();
  for (const visit of visits.data ?? []) {
    const round = Array.isArray(visit.territory_rounds) ? visit.territory_rounds[0] : visit.territory_rounds;
    const territoryId = (round as { territory_id?: string } | null)?.territory_id;
    if (territoryId && (!lastVisit.has(territoryId) || (visit.visit_date as string) > lastVisit.get(territoryId)!)) lastVisit.set(territoryId, visit.visit_date as string);
  }

  const buildingCounts = new Map<string, number>();
  // A missing buildings table (migration pending) just means zero buildings on the map card.
  for (const row of buildingRows.error ? [] : buildingRows.data ?? []) buildingCounts.set(row.territory_id as string, (buildingCounts.get(row.territory_id as string) ?? 0) + 1);

  return (territories.data ?? []).map((territory) => {
    const id = territory.id as string;
    const own = (rounds.data ?? []).filter((round) => round.territory_id === id);
    const open = own.find((round) => !round.completed_on) ?? null;
    const territoryBlocks = [...(blocksByTerritory.get(id) ?? [])].sort((x, y) => x.label.localeCompare(y.label, "es", { numeric: true }));
    const done = territoryBlocks.filter((block) => statusOfBlock.get(block.id) === "COMPLETED");
    const pending = territoryBlocks.filter((block) => statusOfBlock.get(block.id) !== "COMPLETED");
    const lastCompleted = [lastDone.get(id) ?? null, ...own.map((round) => round.completed_on as string | null)].filter((date): date is string => Boolean(date)).sort().pop() ?? null;
    const state: TerritoryMapState = territoryBlocks.length && !pending.length ? "COMPLETADO" : done.length || open ? "EN_CURSO" : "SIN_INICIAR";
    const profile = open ? (Array.isArray(open.profiles) ? open.profiles[0] : open.profiles) : null;
    return {
      territory_id: id,
      number: territory.number as number,
      name: (territory.name as string) ?? "",
      total_blocks: territoryBlocks.length,
      completed_blocks: done.length,
      pending_labels: pending.map((block) => block.label),
      state,
      open_round: open ? { conductor: formatConductorName((profile as { full_name?: string } | null)?.full_name), assigned_on: open.assigned_on as string } : null,
      last_completed_on: lastCompleted,
      last_activity_on: lastVisit.get(id) ?? lastCompleted,
      do_not_visit: dnv.get(id) ?? 0,
      buildings: buildingCounts.get(id) ?? 0,
    };
  });
}

export type MapRound = { id: string; name: string; status: "OPEN" | "CLOSED"; year: number };

export async function loadMap(supabase: AdminSupabase, requestedRoundId: string | null = null) {
  const { data: layer, error } = await supabase.from("territory_map_layers").select("id, name, image_url, image_width, image_height").eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  const { data: roundRows, error: roundsError } = await supabase.from("annual_rounds").select("id, name, status, year, opened_at").order("opened_at", { ascending: false });
  if (roundsError) throw new Error(roundsError.message);
  const rounds = (roundRows ?? []).map((round) => ({ id: round.id as string, name: round.name as string, status: round.status as "OPEN" | "CLOSED", year: round.year as number }));
  // Default = the vuelta the app treats as active: the newest open one, else the newest of all.
  const selected = rounds.find((round) => round.id === requestedRoundId) ?? rounds.find((round) => round.status === "OPEN") ?? rounds[0] ?? null;
  const stats = await loadTerritoryStats(supabase, selected?.id ?? null);
  const { data: blocks, error: blocksError } = await supabase.from("blocks").select("id, territory_id, label").eq("active", true).order("label");
  if (blocksError) throw new Error(blocksError.message);
  const { data: statusRows, error: statusError } = selected
    ? await supabase.from("block_round_statuses").select("block_id, status, completed_on").eq("annual_round_id", selected.id)
    : { data: [], error: null };
  if (statusError) throw new Error(statusError.message);
  const blockStatuses = Object.fromEntries((statusRows ?? []).map((row) => [row.block_id as string, { status: row.status as string, completed_on: (row.completed_on as string | null) ?? null }]));
  if (!layer) return { layer: null, features: [], labels: [], badges: [], stats, blocks: blocks ?? [], rounds, selectedRoundId: selected?.id ?? null, blockStatuses };
  const { data: features, error: featuresError } = await supabase.from("territory_map_features").select("id, territory_id, block_id, points").eq("layer_id", layer.id);
  if (featuresError) throw new Error(featuresError.message);
  // Street names and the sports zone. Before the Fase 25 migration there is no table: the map just has no texts.
  const labelsResult = await supabase.from("territory_map_labels").select("id, kind, text, x, y, rotation, size, bold, tone, points").eq("layer_id", layer.id);
  const labels = labelsResult.error ? [] : labelsResult.data ?? [];
  const badgesResult = await supabase.from("territory_map_badges").select("territory_id, x, y").eq("layer_id", layer.id);
  const badges = badgesResult.error ? [] : badgesResult.data ?? [];
  return { layer, features: features ?? [], labels, badges, stats, blocks: blocks ?? [], rounds, selectedRoundId: selected?.id ?? null, blockStatuses };
}
