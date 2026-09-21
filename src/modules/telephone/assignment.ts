export const PHONE_MINIMUM = 20;

export const phoneActivities = ["NO_ABONADO", "NO_SE_LLAMO", "SE_LLAMO", "NEGOCIO"] as const;
export type PhoneActivity = (typeof phoneActivities)[number];

export const phoneActivityLabels: Record<PhoneActivity, string> = {
  NO_ABONADO: "No abonado / Fuera de servicio",
  NO_SE_LLAMO: "No se llamó",
  SE_LLAMO: "Se llamó",
  NEGOCIO: "Negocio",
};

export function isPhoneActivity(value: unknown): value is PhoneActivity {
  return typeof value === "string" && (phoneActivities as readonly string[]).includes(value);
}

/** Digits only: "11 4444-5555" and "1144445555" are the same number. */
export function phoneKey(raw: string) {
  return raw.replace(/\D+/g, "");
}

export function normalizePhone(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

/** Bulk paste: one number per line (or separated by commas/semicolons). Reports what was skipped. */
export function parsePhoneList(text: string, existingKeys: ReadonlySet<string> = new Set()) {
  const accepted: { number: string; number_key: string }[] = [];
  const skipped: { value: string; reason: "invalid" | "duplicate" }[] = [];
  const seen = new Set(existingKeys);
  for (const raw of text.split(/[\n\r;,]+/)) {
    const value = normalizePhone(raw);
    if (!value) continue;
    const key = phoneKey(value);
    if (key.length < 6 || key.length > 15) { skipped.push({ value, reason: "invalid" }); continue; }
    if (seen.has(key)) { skipped.push({ value, reason: "duplicate" }); continue; }
    seen.add(key);
    accepted.push({ number: value, number_key: key });
  }
  return { accepted, skipped };
}

export type PhoneTerritory = {
  id: string;
  number: number;
  /** Active numbers in this territory. */
  phone_count: number;
  /** Most recent activity on any of its numbers; null = never worked (oldest possible). */
  last_activity_on: string | null;
};

/** Most behind first: never worked, then oldest activity; territory number breaks ties. */
export function orderByAge<T extends { number: number; last_activity_on: string | null }>(territories: T[]) {
  return [...territories].sort((a, b) => {
    if (a.last_activity_on === b.last_activity_on) return a.number - b.number;
    if (a.last_activity_on === null) return -1;
    if (b.last_activity_on === null) return 1;
    return a.last_activity_on.localeCompare(b.last_activity_on) || a.number - b.number;
  });
}

/**
 * Telephone assignment for a Zoom outing:
 *  1. every number of the planned (primary) territory;
 *  2. if that gives fewer than the minimum, add ALL numbers of the most behind territory,
 *     then the next most behind, until reaching/exceeding the minimum or running out.
 * The primary territory is never replaced, and territories are always added whole.
 */
export function selectTerritoriesForPhoneOuting(primaryId: string, territories: PhoneTerritory[], minimum = PHONE_MINIMUM) {
  const primary = territories.find((territory) => territory.id === primaryId);
  const chosen: PhoneTerritory[] = primary ? [primary] : [];
  let total = primary?.phone_count ?? 0;
  if (total >= minimum) return { territory_ids: chosen.map((territory) => territory.id), total };
  const candidates = orderByAge(territories.filter((territory) => territory.id !== primaryId && territory.phone_count > 0));
  for (const candidate of candidates) {
    if (total >= minimum) break;
    chosen.push(candidate);
    total += candidate.phone_count;
  }
  return { territory_ids: chosen.map((territory) => territory.id), total };
}

/** Quick-entry helper: which assigned numbers still have no result for this outing. */
export function pendingResults(assigned: { phone_number_id: string }[], recorded: ReadonlySet<string>) {
  return assigned.filter((entry) => !recorded.has(entry.phone_number_id));
}
