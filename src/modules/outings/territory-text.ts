import { formatPendingBlocks } from "../../lib/domain";

export type SlotTerritoryText = {
  number: number | string;
  /** Blocks still to do of the territory's open round; empty/absent = the whole territory. */
  pendingLabels?: readonly string[] | null;
  /** Text typed by the planner; wins over the automatic one. */
  override?: string | null;
};

/**
 * How an outing's territories read on the calendar: complete territories by number, partial ones
 * with the blocks that are missing, joined with "+". Example: "22+15(M1-M2)" = all of 22 plus
 * blocks M1 to M2 of 15.
 */
export function formatSlotTerritories(entries: readonly SlotTerritoryText[]): string {
  return entries
    .map((entry) => {
      const custom = entry.override?.trim();
      if (custom) return custom;
      const pending = entry.pendingLabels ?? [];
      return pending.length ? `${entry.number}(${formatPendingBlocks([...pending])})` : `${entry.number}`;
    })
    .join("+");
}
