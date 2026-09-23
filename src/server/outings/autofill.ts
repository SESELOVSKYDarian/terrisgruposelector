import "server-only";

import {
  isoWeekdayOf,
  matchPointByLugar,
  normalizePointKind,
  pointLugar,
  prioritizeTerritories,
  suggestOptions,
  type Suggestion,
  type SuggestionPoint,
} from "@/modules/outings/suggestions";
import type { AdminSupabase } from "./planning";

export type AutoFillChange = { slotId: string; slotDate: string; lugarChanged: boolean; territoriesChanged: boolean };
export type AutoFillResult = { filled: number; skipped: number; changes: AutoFillChange[] };
export type AutoFillFailure = { error: string; status?: number };

type SlotRow = { id: string; slot_date: string; sort_order: number; lugar: string | null; status?: string | null; is_zoom?: boolean | null; group_id?: string | null };

/**
 * Fills a week's outings with the territory (and meeting point) that best fits each day.
 * - Fill mode (no `regenerateSlotIds`): completes only the outings that have no territory yet.
 * - Regenerate mode: replaces territory + lugar of the given outings with a *different* suggestion,
 *   leaving every other outing untouched.
 */
export async function autoFillWeek(
  supabase: AdminSupabase,
  input: { weeklyOutingId: string; regenerateSlotIds?: string[] },
): Promise<AutoFillResult | AutoFillFailure> {
  const { weeklyOutingId } = input;
  const { data: outing, error: outingError } = await supabase.from("weekly_outings").select("starts_on").eq("id", weeklyOutingId).single();
  if (outingError || !outing) return { error: "Semana no encontrada.", status: 404 };

  const [territoriesResult, roundsResult, completedResult, slotsResult, pointsResult] = await Promise.all([
    supabase.from("territories").select("id").eq("active", true),
    supabase.from("territory_rounds").select("id,territory_id,assigned_on,completed_on"),
    supabase.from("block_round_statuses").select("completed_on,blocks(territory_id)").eq("status", "COMPLETED"),
    supabase.from("weekly_outing_slots").select("*").eq("weekly_outing_id", weeklyOutingId),
    supabase.from("departure_points").select("*, departure_point_territories(territory_id,sort_order)"),
  ]);
  const firstError = [territoriesResult.error, roundsResult.error, completedResult.error, slotsResult.error, pointsResult.error].find(Boolean);
  if (firstError) return { error: firstError.message };

  const activeTerritoryIds = new Set((territoriesResult.data ?? []).map((territory) => territory.id as string));
  const points: SuggestionPoint[] = (pointsResult.data ?? []).map((point) => ({
    id: point.id as string,
    name: (point.name as string) ?? "",
    address: point.address as string,
    kind: normalizePointKind(point.kind),
    availableDays: Array.isArray(point.available_days) ? (point.available_days as number[]) : [],
    territoryIds: [...((point.departure_point_territories ?? []) as { territory_id: string; sort_order: number }[])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((entry) => entry.territory_id)
      .filter((id) => activeTerritoryIds.has(id)),
  }));

  const lastCompleted = new Map<string, string>();
  for (const status of completedResult.data ?? []) {
    const blockRef = Array.isArray(status.blocks) ? status.blocks[0] : status.blocks;
    const territoryId = blockRef?.territory_id as string | undefined;
    if (!territoryId || !status.completed_on) continue;
    const current = lastCompleted.get(territoryId);
    if (!current || (status.completed_on as string) > current) lastCompleted.set(territoryId, status.completed_on as string);
  }
  const openRound = new Map<string, { id: string; assigned_on: string }>();
  for (const round of roundsResult.data ?? []) {
    if (!round.completed_on) openRound.set(round.territory_id as string, { id: round.id as string, assigned_on: round.assigned_on as string });
  }
  const priority = prioritizeTerritories(
    [...activeTerritoryIds].map((id) => ({ id, openSince: openRound.get(id)?.assigned_on ?? null, lastCompleted: lastCompleted.get(id) ?? null })),
  );

  const existingSlots = (slotsResult.data ?? []) as SlotRow[];
  const slotIds = existingSlots.map((slot) => slot.id);
  const { data: slotTerritoryRows, error: slotTerritoriesError } = slotIds.length
    ? await supabase.from("weekly_outing_slot_territories").select("slot_id,territory_id").in("slot_id", slotIds)
    : { data: [], error: null };
  if (slotTerritoriesError) return { error: slotTerritoriesError.message };
  const territoriesBySlot = new Map<string, string[]>();
  for (const row of slotTerritoryRows ?? []) {
    territoriesBySlot.set(row.slot_id as string, [...(territoriesBySlot.get(row.slot_id as string) ?? []), row.territory_id as string]);
  }

  const regenerating = input.regenerateSlotIds !== undefined;
  const targets: SlotRow[] = [];
  if (regenerating) {
    const wanted = new Set(input.regenerateSlotIds);
    for (const slot of existingSlots) {
      if (!wanted.has(slot.id)) continue;
      if (slot.status === "CANCELADA" || slot.is_zoom || slot.group_id) continue;
      targets.push(slot);
    }
    if (!targets.length) return { error: "No hay salidas para regenerar: las canceladas, de Zoom o por grupo no se tocan.", status: 422 };
  } else {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(`${outing.starts_on}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const day = date.toISOString().slice(0, 10);
      const daySlots = existingSlots.filter((slot) => slot.slot_date === day);
      const empty = daySlots.filter((slot) => !(territoriesBySlot.get(slot.id)?.length));
      if (empty.length) {
        targets.push(...empty);
      } else if (!daySlots.length) {
        const { data: created, error } = await supabase
          .from("weekly_outing_slots")
          .insert({ weekly_outing_id: weeklyOutingId, slot_date: day, sort_order: 0 })
          .select("*")
          .single();
        if (error) return { error: error.message };
        if (created) targets.push(created as SlotRow);
      }
    }
  }
  targets.sort((a, b) => a.slot_date.localeCompare(b.slot_date) || a.sort_order - b.sort_order);

  const targetIds = new Set(targets.map((slot) => slot.id));
  const used = new Set<string>();
  const dayPoints = new Map<string, Set<string>>();
  for (const slot of existingSlots) {
    if (targetIds.has(slot.id)) continue;
    for (const id of territoriesBySlot.get(slot.id) ?? []) used.add(id);
    const point = matchPointByLugar(points, slot.lugar);
    if (point) dayPoints.set(slot.slot_date, new Set([...(dayPoints.get(slot.slot_date) ?? []), point.id]));
  }

  let filled = 0;
  let skipped = 0;
  const changes: AutoFillChange[] = [];

  for (const slot of targets) {
    const isoWeekday = isoWeekdayOf(slot.slot_date);
    const previousTerritories = territoriesBySlot.get(slot.id) ?? [];
    const previousPoint = matchPointByLugar(points, slot.lugar);
    const sameDay = dayPoints.get(slot.slot_date) ?? new Set<string>();
    const ownExclusions = regenerating && previousPoint ? new Set([previousPoint.id]) : new Set<string>();
    const excludeTerritoryIds = regenerating ? new Set(previousTerritories) : undefined;
    const pick = (excludePointIds: Set<string>, pool: readonly SuggestionPoint[]) => suggestOptions({ points: pool, priority, isoWeekday, usedTerritoryIds: used, excludeTerritoryIds, excludePointIds })[0] as Suggestion | undefined;

    let choice: Suggestion | undefined;
    let keepLugar = false;
    if (!regenerating && slot.lugar) {
      // The planner already typed a place: stay with it and pick a territory near it.
      keepLugar = true;
      if (previousPoint) {
        // They chose this point on purpose, so today's day/house rules don't apply to it.
        const forced = { ...previousPoint, kind: "ESQUINA" as const, availableDays: [] };
        choice = pick(new Set(), [forced]);
        if (choice?.point === null) choice = undefined;
      }
      choice ??= pick(new Set(), points);
    } else {
      choice = pick(new Set([...sameDay, ...ownExclusions]), points) ?? (sameDay.size ? pick(ownExclusions, points) : undefined);
    }

    if (!choice) {
      skipped += 1;
      continue;
    }
    used.add(choice.territoryId);
    if (choice.point) dayPoints.set(slot.slot_date, new Set([...sameDay, choice.point.id]));

    const newLugar = keepLugar ? slot.lugar : choice.point ? pointLugar(choice.point) : null;
    const lugarChanged = newLugar !== slot.lugar;

    // New territory goes in before the old ones come out, so a failure never leaves the outing empty.
    const { error: insertError } = await supabase.from("weekly_outing_slot_territories").insert({
      slot_id: slot.id,
      territory_id: choice.territoryId,
      territory_round_id: openRound.get(choice.territoryId)?.id ?? null,
      sort_order: 0,
    });
    if (insertError) return { error: insertError.message };
    if (regenerating && previousTerritories.length) {
      const { error: deleteError } = await supabase.from("weekly_outing_slot_territories").delete().eq("slot_id", slot.id).in("territory_id", previousTerritories);
      if (deleteError) return { error: deleteError.message };
    }
    if (lugarChanged) {
      const { error: updateError } = await supabase.from("weekly_outing_slots").update({ lugar: newLugar, updated_at: new Date().toISOString() }).eq("id", slot.id);
      if (updateError) return { error: updateError.message };
    }

    filled += 1;
    changes.push({ slotId: slot.id, slotDate: slot.slot_date, lugarChanged, territoriesChanged: true });
  }

  return { filled, skipped, changes };
}
