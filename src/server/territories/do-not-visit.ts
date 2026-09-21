import "server-only";

import type { AdminSupabase } from "@/server/outings/planning";

/** Active addresses for the given territories (used to warn on outings). Empty input = no query. */
export async function activeDoNotVisit(supabase: AdminSupabase, territoryIds: string[]) {
  if (!territoryIds.length) return [];
  const { data, error } = await supabase.from("do_not_visit_addresses").select("id, territory_id, address").in("territory_id", territoryIds).eq("active", true).order("address");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; territory_id: string; address: string }[];
}

/** Active count per territory, for the map's territory card. */
export async function doNotVisitCounts(supabase: AdminSupabase) {
  const { data, error } = await supabase.from("do_not_visit_addresses").select("territory_id").eq("active", true);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.territory_id as string, (counts.get(row.territory_id as string) ?? 0) + 1);
  return counts;
}
