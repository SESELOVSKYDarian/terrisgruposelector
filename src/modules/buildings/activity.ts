export type LockDuration = { amount: number; unit: "days" | "weeks" | "months" };

export const DEFAULT_LOCK: LockDuration = { amount: 1, unit: "months" };
export const lockUnitLabels: Record<LockDuration["unit"], string> = { days: "días", weeks: "semanas", months: "meses" };

export function validateLockDuration(input: unknown): { ok: true; value: LockDuration } | { ok: false; error: string } {
  const value = input as Partial<LockDuration> | null;
  if (!value || typeof value.amount !== "number" || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 365) return { ok: false, error: "La cantidad debe ser un entero entre 1 y 365." };
  if (value.unit !== "days" && value.unit !== "weeks" && value.unit !== "months") return { ok: false, error: "Unidad inválida." };
  if (value.unit === "months" && value.amount > 24) return { ok: false, error: "El bloqueo no puede superar 24 meses." };
  return { ok: true, value: { amount: value.amount, unit: value.unit } };
}

/**
 * End of a temporary lock counted from `from`. Months are CALENDAR months (15 Jan + 1 month =
 * 15 Feb; 31 Jan + 1 month = 28 Feb), never a hardcoded 30 days.
 */
export function addLock(from: Date, duration: LockDuration) {
  const result = new Date(from.getTime());
  if (duration.unit === "days") result.setUTCDate(result.getUTCDate() + duration.amount);
  else if (duration.unit === "weeks") result.setUTCDate(result.getUTCDate() + duration.amount * 7);
  else {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + duration.amount);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  }
  return result;
}

export type Outcome = "REVISITA" | "TRABAJADO";

/**
 * Attended + interested = REVISITA (counts as completed, held by whoever marked it).
 * Attended without interest, or not attended = TRABAJADO (temporary lock).
 */
export function outcomeFor(attended: boolean, interested: boolean | null | undefined): Outcome {
  return attended && interested ? "REVISITA" : "TRABAJADO";
}

export type ActivityRow = {
  id: string;
  unit_id: string;
  user_id: string | null;
  attended: boolean;
  interested: boolean | null;
  outcome: Outcome;
  worked_at: string;
  next_available_at: string | null;
  revisit_active: boolean;
  undone_at: string | null;
  unlocked_at: string | null;
  round_id: string | null;
};

export type UnitState = "DISPONIBLE" | "BLOQUEADO" | "REVISITA";
export type UnitStatus = { state: UnitState; owner_id: string | null; blocked_until: string | null; last_worked_at: string | null; last_activity_id: string | null };

/** Live activities of a unit, newest first (undone ones are history only). */
export function liveActivities<T extends { undone_at: string | null; worked_at: string }>(activities: T[]) {
  return activities.filter((activity) => !activity.undone_at).sort((a, b) => b.worked_at.localeCompare(a.worked_at));
}

/** Current state of a unit from its history: an active revisita, a temporary lock, or free. */
export function unitStatus(activities: ActivityRow[], now: Date): UnitStatus {
  const [latest] = liveActivities(activities);
  if (!latest) return { state: "DISPONIBLE", owner_id: null, blocked_until: null, last_worked_at: null, last_activity_id: null };
  const base = { last_worked_at: latest.worked_at, last_activity_id: latest.id };
  if (latest.outcome === "REVISITA" && latest.revisit_active && !latest.unlocked_at) return { ...base, state: "REVISITA", owner_id: latest.user_id, blocked_until: null };
  if (latest.next_available_at && !latest.unlocked_at && new Date(latest.next_available_at).getTime() > now.getTime()) return { ...base, state: "BLOQUEADO", owner_id: latest.user_id, blocked_until: latest.next_available_at };
  return { ...base, state: "DISPONIBLE", owner_id: null, blocked_until: null };
}

/** Who may work a unit right now: free units by anyone, a revisita only by its owner. */
export function canWorkUnit(status: UnitStatus, userId: string): { ok: true } | { ok: false; reason: string } {
  if (status.state === "DISPONIBLE") return { ok: true };
  if (status.state === "REVISITA") return status.owner_id === userId ? { ok: true } : { ok: false, reason: "Este departamento es una revisita de otra persona." };
  return { ok: false, reason: "Este departamento está bloqueado temporalmente." };
}

/** Undo is for the author's most recent live mark on the unit, or for managers on any live mark. */
export function canUndo(status: UnitStatus, activity: { id: string; user_id: string | null }, userId: string, isManager: boolean) {
  if (isManager) return true;
  return activity.user_id === userId && status.last_activity_id === activity.id;
}

/**
 * A unit is done for a round when it was worked in that round, or when it is held as an active
 * revisita (a revisita counts as completed even if it was opened in an earlier round).
 */
export function isDoneForRound(activities: ActivityRow[], roundId: string, now: Date) {
  const live = liveActivities(activities);
  if (live.some((activity) => activity.round_id === roundId)) return true;
  return unitStatus(activities, now).state === "REVISITA";
}

export type RoundProgress = { total: number; done: number; complete: boolean };

/**
 * Progress of a building's round: every ACTIVE unit must be done for the round (worked in it or
 * held as an active revisita). A building with no units never completes a round.
 */
export function roundProgress(units: { id: string; activities: ActivityRow[] }[], roundId: string, now: Date): RoundProgress {
  const done = units.filter((unit) => isDoneForRound(unit.activities, roundId, now)).length;
  return { total: units.length, done, complete: units.length > 0 && done === units.length };
}
