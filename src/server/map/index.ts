import "server-only";

import { formatConductorName } from "@/modules/territories/names";
import { territoryMapState, type TerritoryMapState } from "@/modules/map/geometry";
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

/** Hover/detail numbers for every active territory, from the same rounds the S-13 uses. */
export async function loadTerritoryStats(supabase: AdminSupabase): Promise<MapTerritoryStats[]> {
  const [territories, blocks, rounds, visits, dnv] = await Promise.all([
    supabase.from("territories").select("id, number, name").eq("active", true).order("number"),
    supabase.from("blocks").select("territory_id, label").eq("active", true),
    supabase.from("territory_rounds").select("id, territory_id, assigned_on, completed_on, pending_block_labels, profiles!conductor_id(full_name)"),
    supabase.from("territory_visits").select("visit_date, territory_rounds!inner(territory_id)"),
    doNotVisitCounts(supabase).catch(() => new Map<string, number>()),
  ]);
  for (const result of [territories, blocks, rounds, visits]) if (result.error) throw new Error(result.error.message);

  const labelsByTerritory = new Map<string, string[]>();
  for (const block of blocks.data ?? []) labelsByTerritory.set(block.territory_id as string, [...(labelsByTerritory.get(block.territory_id as string) ?? []), block.label as string]);
  const lastVisit = new Map<string, string>();
  for (const visit of visits.data ?? []) {
    const round = Array.isArray(visit.territory_rounds) ? visit.territory_rounds[0] : visit.territory_rounds;
    const territoryId = (round as { territory_id?: string } | null)?.territory_id;
    if (territoryId && (!lastVisit.has(territoryId) || (visit.visit_date as string) > lastVisit.get(territoryId)!)) lastVisit.set(territoryId, visit.visit_date as string);
  }

  return (territories.data ?? []).map((territory) => {
    const id = territory.id as string;
    const labels = labelsByTerritory.get(id) ?? [];
    const own = (rounds.data ?? []).filter((round) => round.territory_id === id);
    const open = own.find((round) => !round.completed_on) ?? null;
    const pending = open ? ((open.pending_block_labels as string[]) ?? []).filter((label) => labels.includes(label)) : [];
    const lastCompleted = own.map((round) => round.completed_on as string | null).filter((date): date is string => Boolean(date)).sort().pop() ?? null;
    // Between rounds the last closed round completed every block; with none closed nothing is done yet.
    const completed = open ? labels.length - pending.length : lastCompleted ? labels.length : 0;
    const profile = open ? (Array.isArray(open.profiles) ? open.profiles[0] : open.profiles) : null;
    return {
      territory_id: id,
      number: territory.number as number,
      name: (territory.name as string) ?? "",
      total_blocks: labels.length,
      completed_blocks: completed,
      pending_labels: open ? pending : lastCompleted ? [] : labels,
      state: territoryMapState(Boolean(open), Boolean(lastCompleted)),
      open_round: open ? { conductor: formatConductorName((profile as { full_name?: string } | null)?.full_name), assigned_on: open.assigned_on as string } : null,
      last_completed_on: lastCompleted,
      last_activity_on: lastVisit.get(id) ?? null,
      do_not_visit: dnv.get(id) ?? 0,
      buildings: 0,
    };
  });
}

export async function loadMap(supabase: AdminSupabase) {
  const { data: layer, error } = await supabase.from("territory_map_layers").select("id, name, image_url, image_width, image_height").eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  const stats = await loadTerritoryStats(supabase);
  const { data: blocks, error: blocksError } = await supabase.from("blocks").select("id, territory_id, label").eq("active", true).order("label");
  if (blocksError) throw new Error(blocksError.message);
  if (!layer) return { layer: null, features: [], stats, blocks: blocks ?? [] };
  const { data: features, error: featuresError } = await supabase.from("territory_map_features").select("id, territory_id, block_id, points").eq("layer_id", layer.id);
  if (featuresError) throw new Error(featuresError.message);
  return { layer, features: features ?? [], stats, blocks: blocks ?? [] };
}
