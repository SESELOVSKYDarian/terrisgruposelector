import "server-only";

import { reportedOutingsFromVisits, type ReportedOuting, type VisitRow } from "@/modules/outings/reported";
import type { AdminSupabase } from "./planning";

export type { ReportedOuting };

const HISTORY_DAYS = 120;

/**
 * Territories that were actually worked, and in which outing. Source of truth is the conductor's
 * report (outing_reports -> territory_visits.slot_id): a planned outing nobody reported, or a
 * report with no blocks marked as done, does not count as worked.
 */
export async function loadReportedOutings(supabase: AdminSupabase, options: { excludeSlotIds?: ReadonlySet<string> } = {}): Promise<ReportedOuting[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HISTORY_DAYS);
  const { data, error } = await supabase
    .from("territory_visits")
    .select("slot_id, outing_report_id, done_labels, territory_rounds(territory_id), weekly_outing_slots(slot_date, hora)")
    .not("outing_report_id", "is", null)
    .not("slot_id", "is", null)
    .gte("visit_date", cutoff.toISOString().slice(0, 10));
  if (error) throw new Error(error.message);
  return reportedOutingsFromVisits((data ?? []) as unknown as VisitRow[], options);
}
