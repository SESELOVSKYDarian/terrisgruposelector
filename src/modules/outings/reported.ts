export type ReportedOuting = { territoryId: string; date: string; hora: string | null; slotId: string };

type One<T> = T | T[] | null;
export type VisitRow = {
  slot_id: string | null;
  outing_report_id?: string | null;
  done_labels: string[] | null;
  territory_rounds: One<{ territory_id: string }>;
  weekly_outing_slots: One<{ slot_date: string; hora: string | null }>;
};

const first = <T>(value: One<T> | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/**
 * Which territories were actually worked, and in which outing, from conductor reports.
 * A visit counts only when it hangs from a report of a real outing (slot) and has at least one block
 * marked as done. Planned outings nobody reported never appear here.
 */
export function reportedOutingsFromVisits(rows: readonly VisitRow[], options: { excludeSlotIds?: ReadonlySet<string> } = {}): ReportedOuting[] {
  const outings: ReportedOuting[] = [];
  for (const row of rows) {
    if (!row.slot_id || row.outing_report_id === null || !row.done_labels?.length) continue;
    if (options.excludeSlotIds?.has(row.slot_id)) continue;
    const territoryId = first(row.territory_rounds)?.territory_id;
    const slot = first(row.weekly_outing_slots);
    if (!territoryId || !slot) continue;
    outings.push({ territoryId, date: slot.slot_date, hora: slot.hora, slotId: row.slot_id });
  }
  return outings;
}
