import "server-only";

import { formatConductorName } from "@/modules/territories/names";
import { buildS13Pages } from "@/modules/s13/layout";
import type { AdminSupabase } from "@/server/outings/planning";

export type S13DocumentInfo = { code: string; title: string; first_territory: number; last_territory: number };

export async function listS13Documents(supabase: AdminSupabase): Promise<S13DocumentInfo[]> {
  const { data, error } = await supabase.from("s13_documents").select("code,title,first_territory,last_territory").order("first_territory");
  if (error) throw new Error(error.message);
  return (data ?? []) as S13DocumentInfo[];
}

/** Computes one S-13 document straight from the rounds in the database (never stored, never stale). */
export async function loadS13Document(supabase: AdminSupabase, document: S13DocumentInfo) {
  const { data: territories, error } = await supabase.from("territories").select("id, number").gte("number", document.first_territory).lte("number", document.last_territory).order("number");
  if (error) throw new Error(error.message);
  const ids = (territories ?? []).map((territory) => territory.id as string);
  if (!ids.length) return { document, pages: [] };

  const [{ data: rounds, error: roundsError }, { data: statuses, error: statusesError }] = await Promise.all([
    supabase.from("territory_rounds").select("id, territory_id, assigned_on, completed_on, profiles!conductor_id(full_name)").in("territory_id", ids),
    supabase.from("block_round_statuses").select("completed_on, blocks!inner(territory_id)").eq("status", "COMPLETED").not("completed_on", "is", null),
  ]);
  if (roundsError) throw new Error(roundsError.message);
  if (statusesError) throw new Error(statusesError.message);

  // History from before rounds were tracked per territory feeds page 1's "última fecha" column.
  const legacyLast = new Map<string, string>();
  for (const status of statuses ?? []) {
    const block = Array.isArray(status.blocks) ? status.blocks[0] : status.blocks;
    const territoryId = (block as { territory_id?: string } | null)?.territory_id;
    if (!territoryId || !ids.includes(territoryId)) continue;
    const current = legacyLast.get(territoryId);
    if (!current || (status.completed_on as string) > current) legacyLast.set(territoryId, status.completed_on as string);
  }

  const pages = buildS13Pages(
    (territories ?? []).map((territory) => ({
      number: territory.number as number,
      legacy_last_completed_on: legacyLast.get(territory.id as string) ?? null,
      rounds: (rounds ?? [])
        .filter((round) => round.territory_id === territory.id)
        .map((round) => {
          const profile = Array.isArray(round.profiles) ? round.profiles[0] : round.profiles;
          return { id: round.id as string, assigned_on: round.assigned_on as string, completed_on: (round.completed_on as string | null) ?? null, conductor_name: formatConductorName((profile as { full_name?: string } | null)?.full_name) };
        }),
    })),
  );
  return { document, pages };
}
