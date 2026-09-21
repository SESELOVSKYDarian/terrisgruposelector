export const PERIOD_MONTHS = 3;

export const personalModes = ["CASA_EN_CASA", "TELEFONICO", "EDIFICIOS"] as const;
export type PersonalMode = (typeof personalModes)[number];
export const personalModeLabels: Record<PersonalMode, string> = { CASA_EN_CASA: "Casa en casa", TELEFONICO: "Telefónico", EDIFICIOS: "Edificios" };

/** "2026-09-15" + 3 calendar months = "2026-12-15"; month-end dates clamp (30 Nov + 3 = 28 Feb). */
export function addMonthsIso(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Period `index` of an assignment: always counted from the ASSIGNMENT DATE (not calendar
 * quarters) and anchored on it so clamping a short month never drifts later periods.
 */
export function periodBounds(assignedOn: string, index: number) {
  return { start: addMonthsIso(assignedOn, PERIOD_MONTHS * index), end: addMonthsIso(assignedOn, PERIOD_MONTHS * (index + 1)) };
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export type PersonalReminderStage = "SOON" | "DUE" | "OVERDUE";

/**
 * Reminder for a period: a week before, on the due date, and three days after if still not
 * reported. Only the most urgent stage that is due fires (a late run never floods), and the
 * period end is part of the key so the next period starts fresh.
 */
export function currentPersonalStage(today: string, periodEnd: string): PersonalReminderStage | null {
  const left = daysBetween(today, periodEnd);
  if (left <= -3) return "OVERDUE";
  if (left <= 0) return "DUE";
  if (left <= 7) return "SOON";
  return null;
}

export function personalReminderKey(assignmentId: string, periodEnd: string, stage: PersonalReminderStage) {
  return `personal-territory:${assignmentId}:${periodEnd}:${stage}`;
}

export function personalReminderMessage(stage: PersonalReminderStage, territoryNumber: number | string, periodEnd: string) {
  const [year, month, day] = periodEnd.split("-");
  const date = `${Number(day)}/${Number(month)}/${year}`;
  if (stage === "SOON") return `Tu informe del territorio personal ${territoryNumber} vence el ${date}.`;
  if (stage === "DUE") return `Hoy vence el informe de tu territorio personal ${territoryNumber} (${date}).`;
  return `Tu informe del territorio personal ${territoryNumber} está atrasado (venció el ${date}).`;
}

/** Report is only accepted for the running period, from a week before it ends. */
export function canReportPeriod(today: string, periodStart: string, periodEnd: string) {
  return today >= periodStart && daysBetween(today, periodEnd) <= 7 * 4;
}
