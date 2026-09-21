import { isValidHora } from "../outings/recurring";

const AR_OFFSET = "-03:00";

export type ReminderStage = "WEEK_BEFORE" | "H24" | "H6" | "H2";

const HOUR = 60 * 60 * 1000;
const stageOffsetsBeforeDeadline: Record<Exclude<ReminderStage, "WEEK_BEFORE">, number> = { H24: 24 * HOUR, H6: 6 * HOUR, H2: 2 * HOUR };

/** "2026-09-26T21:00" typed in Argentina → real instant. Server-side so it never depends on the browser zone. */
export function argentinaLocalToDate(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00${AR_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function windowServiceDates(window: { saturday_date: string | null; sunday_date: string | null }) {
  return [window.saturday_date, window.sunday_date].filter((date): date is string => Boolean(date));
}

/** Thursday that starts the Thursday→Wednesday planning week containing `date`. */
export function planningWeekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  const isodow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - ((isodow - 4 + 7) % 7));
  return day.toISOString().slice(0, 10);
}

/** Weekend selection: Saturday, Sunday or both. Sunday is always the day after that Saturday. */
export function datesForSelection(saturday: string, days: "SATURDAY" | "SUNDAY" | "BOTH") {
  const base = new Date(`${saturday}T00:00:00Z`);
  if (Number.isNaN(base.getTime()) || base.getUTCDay() !== 6) return null;
  const sunday = new Date(base);
  sunday.setUTCDate(sunday.getUTCDate() + 1);
  return {
    saturday_date: days === "SUNDAY" ? null : saturday,
    sunday_date: days === "SATURDAY" ? null : sunday.toISOString().slice(0, 10),
  };
}

export function isWindowOpen(deadline: string | Date, now = new Date()) {
  return new Date(deadline).getTime() > now.getTime();
}

/**
 * Most urgent reminder that is due and not stale: one week before the first outing,
 * then 24h / 6h / 2h before the (possibly extended) deadline. Returns null once the
 * deadline has passed. Only the latest due stage fires, so a late run never floods.
 */
export function currentReminderStage(now: Date, deadline: Date, firstServiceDate: string): { stage: ReminderStage; dueAt: Date } | null {
  if (deadline.getTime() <= now.getTime()) return null;
  const firstOuting = new Date(`${firstServiceDate}T00:00:00${AR_OFFSET}`);
  const deadlineStages = (Object.keys(stageOffsetsBeforeDeadline) as (keyof typeof stageOffsetsBeforeDeadline)[]).map((stage): { stage: ReminderStage; dueAt: Date } => ({ stage, dueAt: new Date(deadline.getTime() - stageOffsetsBeforeDeadline[stage]) }));
  const stages: { stage: ReminderStage; dueAt: Date }[] = [
    { stage: "WEEK_BEFORE" as ReminderStage, dueAt: new Date(firstOuting.getTime() - 7 * 24 * HOUR) },
    ...deadlineStages,
  ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const due = stages.filter((entry) => entry.dueAt.getTime() <= now.getTime());
  return due.length ? due[due.length - 1] : null;
}

/** The deadline is part of the key: extending it re-arms every stage for the new date. */
export function reminderNaturalKey(windowId: string, groupId: string, recipientId: string, stage: ReminderStage, deadline: Date) {
  return `group-window:${windowId}:${groupId}:${recipientId}:${stage}:${deadline.toISOString()}`;
}

export type ResponseInput = { lugar: string; hora: string | null; conductor_id: string | null; territory_ids: string[] };

/** Only the place is mandatory; conductor, time and territories can be completed later while the window is open. */
export function validateResponseInput(input: { lugar?: string | null; hora?: string | null; conductor_id?: string | null; territory_ids?: string[] }): { ok: true; value: ResponseInput } | { ok: false; error: string } {
  const lugar = (input.lugar ?? "").trim();
  if (!lugar) return { ok: false, error: "El lugar de salida es obligatorio." };
  if (lugar.length > 180) return { ok: false, error: "El lugar de salida es demasiado largo." };
  const hora = input.hora ? input.hora.trim() : null;
  if (hora && !isValidHora(hora)) return { ok: false, error: "La hora debe tener formato HH:MM." };
  const territory_ids = [...new Set(input.territory_ids ?? [])];
  return { ok: true, value: { lugar, hora, conductor_id: input.conductor_id || null, territory_ids } };
}

export type ResponsibleProfile = { id: string; full_name: string };

/** "Completado por Pérez J." shown to the other responsible person. */
export function completedByLabel(response: { completed_by: string | null } | null, responsibles: ResponsibleProfile[], viewerId: string) {
  if (!response?.completed_by) return null;
  if (response.completed_by === viewerId) return "Completado por vos";
  const author = responsibles.find((person) => person.id === response.completed_by);
  return author ? `Completado por ${author.full_name}` : "Completado";
}

/** "jue 24/09 21:00" in Argentina time, for notifications and the UI. */
export function formatDeadlineEs(value: string | Date) {
  const parts = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday").replace(".", "")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

export function windowTitle(window: { saturday_date: string | null; sunday_date: string | null }) {
  const label = (date: string, name: string) => `${name} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const parts = [window.saturday_date ? label(window.saturday_date, "sáb") : null, window.sunday_date ? label(window.sunday_date, "dom") : null].filter(Boolean);
  return `Salida por Grupo: ${parts.join(" y ")}`;
}

export function reminderMessage(stage: ReminderStage, deadline: Date) {
  const until = formatDeadlineEs(deadline);
  if (stage === "WEEK_BEFORE") return `Próxima semana hay Salida por Grupo. Realizá los preparativos necesarios. Tenés hasta ${until} para completar la información.`;
  const left = stage === "H24" ? "24 horas" : stage === "H6" ? "6 horas" : "2 horas";
  return `Faltan ${left} para completar la información de la Salida por Grupo (vence ${until}).`;
}
