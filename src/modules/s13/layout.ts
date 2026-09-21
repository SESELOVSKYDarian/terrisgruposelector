/** Each territory shows four "Asignado a" blocks per S-13 page. */
export const S13_SLOTS_PER_PAGE = 4;

export type S13Round = { id: string; assigned_on: string; completed_on: string | null; conductor_name: string };
export type S13Slot = { round_id: string; conductor: string; assigned_on: string; completed_on: string | null };
export type S13Row = {
  territory_number: number;
  /** "Última fecha en que se completó": last round of the previous page (page 1: legacy history, if any). */
  last_completed_on: string | null;
  slots: (S13Slot | null)[];
};
export type S13Page = { page: number; rows: S13Row[] };

/** "2026-07-05" -> "5-7-26", exactly as the paper/Google Doc S-13 prints dates. */
export function formatS13Date(iso: string | null | undefined) {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return "";
  return `${Number(match[3])}-${Number(match[2])}-${match[1].slice(2)}`;
}

function byAssignment(a: S13Round, b: S13Round) {
  return a.assigned_on.localeCompare(b.assigned_on) || (a.completed_on ?? "9999").localeCompare(b.completed_on ?? "9999");
}

/**
 * Lays territories out like the real document: every territory occupies two rows (conductor
 * names / assigned + completed dates) with four visible rounds. When a territory's four
 * rounds are used up the next page continues with round 5-8, and its "última fecha" column
 * takes the completion of the last round of the page before. Pages exist for every
 * territory as soon as any of them needs one.
 */
export function buildS13Pages(territories: { number: number; rounds: S13Round[]; legacy_last_completed_on?: string | null }[]): S13Page[] {
  const ordered = [...territories].sort((a, b) => a.number - b.number).map((territory) => ({ ...territory, rounds: [...territory.rounds].sort(byAssignment) }));
  const pageCount = Math.max(1, ...ordered.map((territory) => Math.ceil(territory.rounds.length / S13_SLOTS_PER_PAGE)));
  return Array.from({ length: pageCount }, (_, index) => {
    const start = index * S13_SLOTS_PER_PAGE;
    return {
      page: index + 1,
      rows: ordered.map((territory): S13Row => {
        const slots = Array.from({ length: S13_SLOTS_PER_PAGE }, (_, offset) => {
          const round = territory.rounds[start + offset];
          return round ? { round_id: round.id, conductor: round.conductor_name, assigned_on: round.assigned_on, completed_on: round.completed_on } : null;
        });
        return {
          territory_number: territory.number,
          last_completed_on: index === 0 ? territory.legacy_last_completed_on ?? null : territory.rounds[start - 1]?.completed_on ?? null,
          slots,
        };
      }),
    };
  });
}
