export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(value: Date): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ARGENTINA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function localDateTimeToUtc(parts: LocalDateTime) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = desired;
  // Iteration keeps this correct if Argentina's IANA offset ever changes again.
  for (let index = 0; index < 3; index += 1) {
    const actual = localParts(new Date(guess));
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desired - actualAsUtc;
  }
  return new Date(guess);
}

/** Three local calendar days before the persisted outing timestamp. */
export function weekendReminderDueAt(scheduledAt: Date) {
  const local = localParts(scheduledAt);
  const threeDaysEarlier = new Date(Date.UTC(local.year, local.month - 1, local.day - 3, local.hour, local.minute, local.second));
  return localDateTimeToUtc({ year: threeDaysEarlier.getUTCFullYear(), month: threeDaysEarlier.getUTCMonth() + 1, day: threeDaysEarlier.getUTCDate(), hour: local.hour, minute: local.minute, second: local.second });
}

/** Report deadline is persisted when a V2 outing/report is created; no runner offset is hardcoded. */
export function driverReportReminderDueAt(reportDeadlineAt: Date) {
  return new Date(reportDeadlineAt.getTime());
}

/** Used only when the future V2 report is created; the resulting deadline is persisted. */
export function initialDriverReportDeadline(scheduledAt: Date) {
  return new Date(scheduledAt.getTime() + 3 * 60 * 60 * 1000);
}

export type WeekendReminderCandidate = { naturalKey: string; conductorId: string; outingId: string; reminderAt: Date };
export type DriverReportReminderCandidate = { naturalKey: string; conductorId: string; territoryRoundId: string; reportFormUrl: string; reportDeadlineAt: Date; completedAt: Date | null };
export type ReminderEmitter = (input: { type: "VISIT_REPORT_DUE"; naturalKey: string; payload: { recipientId: string; territoryRoundId: string; title: string; targetUrl: string } }) => Promise<void>;

/** Future repository adapters pass real V2 rows here; extensions alter the stored deadline/reminderAt, not this runner. */
export async function runDriverReportReminders(candidates: DriverReportReminderCandidate[], emit: ReminderEmitter, now = new Date()) {
  let emitted = 0;
  for (const candidate of candidates) {
    if (candidate.completedAt || candidate.reportDeadlineAt > now) continue;
    await emit({ type: "VISIT_REPORT_DUE", naturalKey: candidate.naturalKey, payload: { recipientId: candidate.conductorId, territoryRoundId: candidate.territoryRoundId, title: "Informe de salida pendiente", targetUrl: candidate.reportFormUrl } });
    emitted += 1;
  }
  return emitted;
}

export type PendingReminder = { name: "weekend" | "driver-report"; status: "defined-but-pending"; reason: string };

/**
 * Fase 5 deliberately does not query legacy slots: `hora` is text and there is
 * no completed driver-report signal, so wiring them would create false alerts.
 */
export async function runReminderJobs(): Promise<{ pending: PendingReminder[]; emitted: number }> {
  return { emitted: 0, pending: [
    { name: "weekend", status: "defined-but-pending", reason: "weekend_roster has only a date; no V2 outing timestamptz/deadline is available." },
    { name: "driver-report", status: "defined-but-pending", reason: "weekly_outing_slots.hora is text and no completed driver-report form/signal exists yet." },
  ] };
}
