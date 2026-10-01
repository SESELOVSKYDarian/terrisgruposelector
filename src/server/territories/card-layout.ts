import "server-only";

import { ApiError } from "@/server/api";
import type { AdminSupabase } from "@/server/outings/planning";

export type CardBlock = { label: string; points: [number, number][] };
export type CardStreetLabel = { text: string; x: number; y: number; rotate: number };
export type CardLayout = { territory_id: string; view_box: string; blocks: CardBlock[]; street_labels: CardStreetLabel[] };

export async function loadCardLayout(supabase: AdminSupabase, territoryId: string): Promise<CardLayout | null> {
  const { data, error } = await supabase.from("territory_card_layouts").select("territory_id, view_box, blocks, street_labels").eq("territory_id", territoryId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as CardLayout;
}

/** Every territory that has a card layout drawn, keyed by territory_id (for bulk loading on the conductor's own views). */
export async function loadAllCardLayouts(supabase: AdminSupabase): Promise<Record<string, CardLayout>> {
  const { data, error } = await supabase.from("territory_card_layouts").select("territory_id, view_box, blocks, street_labels");
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.territory_id as string, row as CardLayout]));
}

/** Territory numbers + their block labels, for the editor's picker (not needed by the read-only conductor view). */
export async function loadTerritoriesWithBlocks(supabase: AdminSupabase): Promise<{ id: string; number: number; blocks: string[] }[]> {
  const [{ data: territories, error: territoriesError }, { data: blocks, error: blocksError }] = await Promise.all([
    supabase.from("territories").select("id, number").eq("active", true).order("number"),
    supabase.from("blocks").select("id, territory_id, label").eq("active", true).order("label"),
  ]);
  if (territoriesError) throw new Error(territoriesError.message);
  if (blocksError) throw new Error(blocksError.message);
  return (territories ?? []).map((territory) => ({ id: territory.id as string, number: territory.number as number, blocks: (blocks ?? []).filter((block) => block.territory_id === territory.id).map((block) => block.label as string) }));
}

export async function saveCardLayout(supabase: AdminSupabase, actorId: string, input: { territory_id: string; view_box: string; blocks: CardBlock[]; street_labels: CardStreetLabel[] }) {
  const { data: territory, error: territoryError } = await supabase.from("territories").select("id").eq("id", input.territory_id).maybeSingle();
  if (territoryError) throw new Error(territoryError.message);
  if (!territory) throw new ApiError("Territorio no encontrado.", 404);
  for (const block of input.blocks) {
    if (block.points.length < 3) throw new ApiError(`La manzana "${block.label}" necesita al menos 3 puntos.`, 422);
  }
  const { error } = await supabase.from("territory_card_layouts").upsert(
    { territory_id: input.territory_id, view_box: input.view_box, blocks: input.blocks, street_labels: input.street_labels, updated_by: actorId, updated_at: new Date().toISOString() },
    { onConflict: "territory_id" },
  );
  if (error) throw new Error(error.message);
  return {};
}

export async function deleteCardLayout(supabase: AdminSupabase, territoryId: string) {
  const { error } = await supabase.from("territory_card_layouts").delete().eq("territory_id", territoryId);
  if (error) throw new Error(error.message);
  return {};
}
