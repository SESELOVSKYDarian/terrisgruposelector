import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { addDaysIso } from "@/modules/outings/recurring";
import { argentinaToday } from "@/modules/outings/time";
import type { AdminSupabase } from "@/server/outings/planning";
import { getTerritoryAccess } from "@/server/territories/access";

export type BuildingAccess = {
  /** Superintendente de Servicio / Siervo de Territorios: full control of buildings. */
  canManage: boolean;
  /** Territories the person may consult/work today; null = all (managers). */
  territoryIds: Set<string> | null;
};

/**
 * Buildings belong to territories, and a person reaches them through an outing: everyone who
 * can see a published, non-cancelled outing (last week → next two) may consult and work the
 * buildings of its territories. Managers see every territory.
 */
export async function getBuildingAccess(supabase: AdminSupabase, profile: SessionProfile, now = new Date()): Promise<BuildingAccess> {
  const { canManage } = await getTerritoryAccess(profile);
  if (canManage) return { canManage: true, territoryIds: null };

  const today = argentinaToday(now);
  const { data, error } = await supabase
    .from("weekly_outing_slot_territories")
    .select("territory_id, weekly_outing_slots!inner(slot_date, status, weekly_outings!inner(status))")
    .gte("weekly_outing_slots.slot_date", addDaysIso(today, -7))
    .lte("weekly_outing_slots.slot_date", addDaysIso(today, 14));
  if (error) throw new Error(error.message);

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const slot = Array.isArray(row.weekly_outing_slots) ? row.weekly_outing_slots[0] : row.weekly_outing_slots;
    const week = slot ? (Array.isArray(slot.weekly_outings) ? slot.weekly_outings[0] : slot.weekly_outings) : null;
    if (!slot || slot.status === "CANCELADA") continue;
    if ((week?.status ?? "PUBLISHED") !== "PUBLISHED") continue;
    ids.add(row.territory_id as string);
  }
  // A personal "Edificios" assignment also opens that territory's buildings (pre-migration: ignored).
  const personal = await supabase.from("personal_territory_assignments").select("territory_id").eq("profile_id", profile.id).eq("status", "ACTIVE").eq("mode", "EDIFICIOS");
  if (!personal.error) for (const row of personal.data ?? []) ids.add(row.territory_id as string);
  return { canManage: false, territoryIds: ids };
}

export function canAccessTerritory(access: BuildingAccess, territoryId: string) {
  return access.territoryIds === null || access.territoryIds.has(territoryId);
}
