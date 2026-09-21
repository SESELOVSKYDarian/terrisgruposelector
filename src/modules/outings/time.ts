export const OUTING_TIME_ZONE = "America/Argentina/Buenos_Aires";
// Argentina no usa horario de verano desde 2009: el offset vigente es fijo (UTC-3).
const ARGENTINA_UTC_OFFSET = "-03:00";

export type OutingTimeParseStatus = "PARSED" | "EMPTY" | "UNPARSEABLE";

// Espejo de public.parse_outing_time (supabase/fase-6-weekly-planning-workflow-migration.sql).
// La base es la fuente de verdad de starts_at; esta copia sirve para avisar en la UI y para tests.
const OUTING_TIME_PATTERN = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:(a\.?\s?m\.?|p\.?\s?m\.?)|hs?\.?|hrs?\.?|horas?)?$/;

export function parseOutingTime(raw: string | null | undefined): { hour: number; minute: number } | null {
  if (!raw || !raw.trim()) return null;
  const match = OUTING_TIME_PATTERN.exec(raw.trim().toLowerCase());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (minute > 59) return null;
  const meridiem = match[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem.startsWith("p") && hour < 12) hour += 12;
    else if (meridiem.startsWith("a") && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

export function outingTimeParseStatus(raw: string | null | undefined): OutingTimeParseStatus {
  if (!raw || !raw.trim()) return "EMPTY";
  return parseOutingTime(raw) ? "PARSED" : "UNPARSEABLE";
}

/** Instante real (UTC) de una salida: fecha calendario + hora de Buenos Aires. */
export function outingStartsAt(slotDate: string, rawTime: string | null | undefined): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return null;
  const time = parseOutingTime(rawTime);
  if (!time) return null;
  const hh = String(time.hour).padStart(2, "0");
  const mm = String(time.minute).padStart(2, "0");
  const instant = new Date(`${slotDate}T${hh}:${mm}:00${ARGENTINA_UTC_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** "2026-09-24" -> "24/09/2026" (date-only, no timezone shift). */
export function formatDateEs(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}
