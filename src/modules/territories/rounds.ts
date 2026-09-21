export type VisitLike = {
  visit_date: string;
  created_at?: string | null;
  conductor_id: string;
  done_labels: string[];
  pending_labels: string[];
};

export type RoundSummary = {
  conductor_id: string;
  assigned_on: string;
  completed_on: string | null;
  pending_block_labels: string[];
  done_block_labels: string[];
};

/** Chronological order used everywhere a round is read: visit date, then load time. */
export function sortVisits<T extends VisitLike>(visits: T[]) {
  return [...visits].sort((a, b) => a.visit_date.localeCompare(b.visit_date) || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

/**
 * Pending blocks after each visit = every block minus everything done up to and including
 * that visit. Deriving (instead of trusting stored values) keeps the chain consistent
 * when an earlier report is corrected while the round is still open.
 */
export function derivePendingByVisit(allLabels: string[], visitsInOrder: { done_labels: string[] }[]) {
  const done = new Set<string>();
  return visitsInOrder.map((visit) => {
    for (const label of visit.done_labels) done.add(label);
    return allLabels.filter((label) => !done.has(label));
  });
}

/**
 * S-13 rules for one round. "Asignado a" is the conductor of the FIRST visit and never
 * changes when another conductor continues; the round closes when the last report leaves
 * ZERO pending blocks, and that report's date is the completion date.
 * Returns null when there are no visits (the round has nothing left to say).
 */
export function summarizeRound(visits: VisitLike[]): RoundSummary | null {
  const ordered = sortVisits(visits);
  if (!ordered.length) return null;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    conductor_id: first.conductor_id,
    assigned_on: first.visit_date,
    completed_on: last.pending_labels.length === 0 ? last.visit_date : null,
    pending_block_labels: last.pending_labels,
    done_block_labels: last.done_labels,
  };
}

/** Labels a conductor can still tick for a territory: everything not done by earlier visits of the open round. */
export function labelsStillPending(allLabels: string[], earlierVisits: { done_labels: string[] }[]) {
  const done = new Set(earlierVisits.flatMap((visit) => visit.done_labels));
  return allLabels.filter((label) => !done.has(label));
}

export function allLabelsKnown(done: string[], allLabels: string[]) {
  const known = new Set(allLabels);
  return done.every((label) => known.has(label));
}

/** Blocks already done by the visits of a round before `beforeVisitId` (or by all of them when omitted). */
export function priorDoneLabels(visits: (VisitLike & { id: string })[], beforeVisitId?: string) {
  const ordered = sortVisits(visits);
  const cut = beforeVisitId ? ordered.findIndex((visit) => visit.id === beforeVisitId) : -1;
  const earlier = cut === -1 ? ordered : ordered.slice(0, cut);
  return [...new Set(earlier.flatMap((visit) => visit.done_labels))];
}
