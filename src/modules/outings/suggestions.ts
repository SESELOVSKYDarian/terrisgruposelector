/**
 * Suggestion engine for weekly outings: which meeting point (and which territory near it) fits a
 * given day. Pure and shared by the server (auto-fill / regenerate) and the client (suggestion list).
 *
 * Rules:
 * - Weekends (sábado/domingo) prefer CASA points; weekdays are esquinas.
 * - A CASA is only offered on a weekday when it explicitly lists that weekday as available.
 * - available_days empty = "any day" (existing semantics), except for the weekday rule above.
 * - Territories are ranked by need: open round first (oldest first), then oldest last completion
 *   (never completed = most overdue).
 */

export const pointKinds = ["CASA", "ESQUINA"] as const;
export type PointKind = (typeof pointKinds)[number];
export const pointKindLabels: Record<PointKind, string> = { CASA: "Casa", ESQUINA: "Esquina" };

export function normalizePointKind(value: unknown): PointKind {
  return value === "CASA" ? "CASA" : "ESQUINA";
}

export type SuggestionPoint = {
  id: string;
  name: string;
  address: string;
  kind: PointKind;
  availableDays: number[];
  /** Nearby territories, closest first. */
  territoryIds: string[];
};

export type TerritoryNeed = { id: string; openSince: string | null; lastCompleted: string | null };

export function isoWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWeekendIso(isoWeekday: number) {
  return isoWeekday >= 6;
}

export function pointAllowedOn(point: Pick<SuggestionPoint, "kind" | "availableDays">, isoWeekday: number) {
  const declared = point.availableDays.length > 0;
  if (declared && !point.availableDays.includes(isoWeekday)) return false;
  if (!isWeekendIso(isoWeekday) && point.kind === "CASA" && !declared) return false;
  return true;
}

/** Text stored in the slot's "lugar" when a point is chosen. */
export function pointLugar(point: { address: string; name: string }) {
  return point.name.trim() ? `${point.address} - ${point.name.trim()}` : point.address;
}

/** Finds the point a slot's free-text "lugar" refers to (address, or "address - name"). */
export function matchPointByLugar<T extends { address: string; name: string }>(points: readonly T[], lugar: string | null | undefined): T | null {
  const key = lugar?.trim().toLowerCase();
  if (!key) return null;
  return points.find((point) => pointLugar(point).trim().toLowerCase() === key || point.address.trim().toLowerCase() === key) ?? null;
}

/** Most in need first: open rounds (oldest assignment first), then oldest last completion (never = first). */
export function prioritizeTerritories(needs: readonly TerritoryNeed[]): string[] {
  return [...needs]
    .sort((a, b) => {
      if (Boolean(a.openSince) !== Boolean(b.openSince)) return a.openSince ? -1 : 1;
      if (a.openSince && b.openSince) return a.openSince.localeCompare(b.openSince);
      return (a.lastCompleted ?? "").localeCompare(b.lastCompleted ?? "");
    })
    .map((need) => need.id);
}

export type Suggestion = {
  /** null = a territory to work without a meeting point (none fits the day). */
  point: SuggestionPoint | null;
  territoryId: string;
  /** Position in the need ranking (0 = most in need). */
  rank: number;
};

export type SuggestInput = {
  points: readonly SuggestionPoint[];
  priority: readonly string[];
  isoWeekday: number;
  usedTerritoryIds: ReadonlySet<string>;
  excludeTerritoryIds?: ReadonlySet<string>;
  excludePointIds?: ReadonlySet<string>;
};

/** Every option for one slot, best first. `options[0]` is what auto-fill picks. */
export function suggestOptions(input: SuggestInput): Suggestion[] {
  const rank = new Map(input.priority.map((id, index) => [id, index]));
  const weekend = isWeekendIso(input.isoWeekday);
  const free = (id: string) => rank.has(id) && !input.usedTerritoryIds.has(id) && !input.excludeTerritoryIds?.has(id);

  type Scored = Suggestion & { tier: number; closeness: number; label: string };
  const scored: Scored[] = [];
  const coveredByAllowedPoint = new Set<string>();
  const knownToAnyPoint = new Set<string>();

  for (const point of input.points) {
    for (const id of point.territoryIds) knownToAnyPoint.add(id);
    if (!pointAllowedOn(point, input.isoWeekday) || input.excludePointIds?.has(point.id)) continue;
    for (const id of point.territoryIds) coveredByAllowedPoint.add(id);
    let best: { id: string; index: number } | null = null;
    point.territoryIds.forEach((id, index) => {
      if (!free(id)) return;
      if (!best || rank.get(id)! < rank.get(best.id)!) best = { id, index };
    });
    if (!best) continue;
    const chosen: { id: string; index: number } = best;
    scored.push({ point, territoryId: chosen.id, rank: rank.get(chosen.id)!, tier: weekend && point.kind !== "CASA" ? 1 : 0, closeness: chosen.index, label: point.address });
  }

  for (const id of input.priority) {
    if (!free(id) || coveredByAllowedPoint.has(id)) continue;
    // No point at all: neutral. Only near points that don't fit today: last resort.
    const tier = knownToAnyPoint.has(id) ? (weekend ? 2 : 1) : weekend ? 1 : 0;
    scored.push({ point: null, territoryId: id, rank: rank.get(id)!, tier, closeness: 0, label: "" });
  }

  return scored
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.closeness - b.closeness || a.label.localeCompare(b.label))
    .map(({ point, territoryId, rank: position }) => ({ point, territoryId, rank: position }));
}

/** Distinct meeting points worth showing for a day (drops the "territory only" fallbacks). */
export function suggestPoints(input: SuggestInput, limit = 6) {
  return suggestOptions(input).filter((option): option is Suggestion & { point: SuggestionPoint } => option.point !== null).slice(0, limit);
}
