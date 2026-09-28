import "server-only";

import { callerKey, parsePhoneHistory } from "@/modules/telephone/assignment";
import type { AdminSupabase } from "@/server/outings/planning";

/**
 * Loads pasted phone history: creates the numbers that do not exist yet and brings each one's
 * last activity (date, result, caller) up to date, never replacing a newer activity with an older one.
 * The caller is only linked when exactly one profile matches "Apellido + inicial".
 */
export async function importPhoneHistory(supabase: AdminSupabase, text: string) {
  const { rows, skipped } = parsePhoneHistory(text);
  const [territories, profiles] = await Promise.all([
    supabase.from("territories").select("id, number"),
    supabase.from("profiles").select("id, full_name").eq("active", true),
  ]);
  for (const result of [territories, profiles]) if (result.error) throw new Error(result.error.message);
  const territoryByNumber = new Map((territories.data ?? []).map((row) => [row.number as number, row.id as string]));
  const profileKeys = (profiles.data ?? []).map((row) => ({ id: row.id as string, ...callerKey(String(row.full_name ?? "")) }));

  const callerId = (name: string | null) => {
    if (!name) return null;
    const wanted = callerKey(name);
    if (!wanted.surname || !wanted.initial) return null;
    const matches = profileKeys.filter((profile) => profile.surname === wanted.surname && profile.initial === wanted.initial);
    return matches.length === 1 ? matches[0].id : null;
  };

  const ids = [...new Set(rows.map((row) => territoryByNumber.get(row.territory_number)).filter(Boolean))] as string[];
  const existing = new Map<string, { id: string; last_activity_on: string | null }>();
  if (ids.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("territory_phone_numbers").select("id, territory_id, number_key, last_activity_on").in("territory_id", ids).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) existing.set(`${row.territory_id}:${row.number_key}`, { id: row.id as string, last_activity_on: (row.last_activity_on as string | null) ?? null });
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  let created = 0;
  let updated = 0;
  const unknownTerritories = new Set<number>();
  const seen = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const territoryId = territoryByNumber.get(row.territory_number);
    if (!territoryId) { unknownTerritories.add(row.territory_number); continue; }
    const key = `${territoryId}:${row.number_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const activityFields = { activity: row.activity, last_activity_on: row.last_activity_on, last_conductor_id: callerId(row.caller) };
    const current = existing.get(key);
    if (!current) {
      inserts.push({ territory_id: territoryId, number: row.number, number_key: row.number_key, ...activityFields });
      created += 1;
      continue;
    }
    if (!row.activity && !row.last_activity_on) continue;
    if (current.last_activity_on && row.last_activity_on && row.last_activity_on < current.last_activity_on) continue;
    const { error } = await supabase.from("territory_phone_numbers").update({ ...activityFields, updated_at: now }).eq("id", current.id);
    if (error) throw new Error(error.message);
    updated += 1;
  }
  for (let from = 0; from < inserts.length; from += 500) {
    const { error } = await supabase.from("territory_phone_numbers").insert(inserts.slice(from, from + 500));
    if (error) throw new Error(error.message);
  }
  return { created, updated, invalid: skipped.length, unknown_territories: [...unknownTerritories].sort((a, b) => a - b) };
}
