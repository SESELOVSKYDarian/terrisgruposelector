import "server-only";

import { emitDomainEvent } from "@/server/events";
import { runDriverReportReminders, type DriverReportReminderCandidate } from "./reminders";

/** Adapter used when Fase 9 provides real report rows: reminders re-enter Fase 4's dispatcher. */
export function emitDriverReportReminders(candidates: DriverReportReminderCandidate[], now?: Date) {
  return runDriverReportReminders(candidates, async (input) => { await emitDomainEvent(input); }, now);
}
