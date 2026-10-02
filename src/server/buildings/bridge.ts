import "server-only";

import { houseNumber, streetOf } from "@/modules/buildings/address";
import type { AdminSupabase } from "@/server/outings/planning";
import { ApiError } from "@/server/api";
import { loadUnitStatusesPublic } from "./activity";
import { loadBuilding } from "./index";

export type PublicBuilding = { id: string; address: string; street: string; territory_number: number; needs_census: boolean; unit_count: number };

/** The public site only ever shows active buildings; the list is small enough to filter in memory. */
async function activeBuildings(supabase: AdminSupabase): Promise<PublicBuilding[]> {
  const { data, error } = await supabase.from("buildings").select("id, address, needs_census, territories(number), building_units(id, active)").eq("status", "ACTIVE");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const territory = Array.isArray(row.territories) ? row.territories[0] : row.territories;
    return {
      id: row.id as string,
      address: row.address as string,
      street: streetOf(row.address as string),
      territory_number: (territory as { number?: number } | null)?.number ?? 0,
      needs_census: Boolean(row.needs_census),
      unit_count: ((row.building_units as { active: boolean }[] | null) ?? []).filter((unit) => unit.active).length,
    };
  });
}

const byAddress = (a: PublicBuilding, b: PublicBuilding) => a.street.localeCompare(b.street, "es") || houseNumber(a.address) - houseNumber(b.address) || a.address.localeCompare(b.address, "es");

export async function bridgeSearch(supabase: AdminSupabase, q: string) {
  const term = q.trim().toLowerCase();
  const all = await activeBuildings(supabase);
  if (!term) return { items: [], recommended: [] };
  const isNumber = /^\d+$/.test(term);
  const items = all.filter((building) => (isNumber && building.territory_number === Number(term)) || building.address.toLowerCase().includes(term)).sort(byAddress).slice(0, 20);
  const shown = new Set(items.map((item) => item.id));
  const sameTerritory = items.length ? all.filter((building) => building.territory_number === items[0].territory_number && !shown.has(building.id)).sort(byAddress).slice(0, 6) : [];
  return { items, recommended: sameTerritory };
}

export async function bridgeStreets(supabase: AdminSupabase) {
  const counts = new Map<string, number>();
  for (const building of await activeBuildings(supabase)) counts.set(building.street, (counts.get(building.street) ?? 0) + 1);
  return { streets: [...counts.entries()].map(([street, total]) => ({ street, total })).sort((a, b) => a.street.localeCompare(b.street, "es")) };
}

export async function bridgeStreet(supabase: AdminSupabase, street: string) {
  const key = street.trim().toLowerCase();
  return { items: (await activeBuildings(supabase)).filter((building) => building.street.toLowerCase() === key).sort(byAddress) };
}

export async function bridgeTerritories(supabase: AdminSupabase) {
  const counts = new Map<number, number>();
  for (const building of await activeBuildings(supabase)) counts.set(building.territory_number, (counts.get(building.territory_number) ?? 0) + 1);
  return { territories: [...counts.entries()].map(([number, total]) => ({ number, total })).sort((a, b) => a.number - b.number) };
}

export async function bridgeTerritory(supabase: AdminSupabase, territoryNumber: number) {
  return { items: (await activeBuildings(supabase)).filter((building) => building.territory_number === territoryNumber).sort(byAddress) };
}

export async function bridgeBuilding(supabase: AdminSupabase, buildingId: string) {
  const building = await loadBuilding(supabase, buildingId);
  if (!building || building.status !== "ACTIVE") throw new ApiError("Edificio no encontrado.", 404);
  const statuses = await loadUnitStatusesPublic(supabase, building.id);
  const units = building.units.map((unit) => {
    const status = unit.id ? statuses[unit.id] : undefined;
    return { id: unit.id as string, label: unit.label, state: status?.state ?? "DISPONIBLE", blocked_until: status?.blocked_until ?? null };
  });
  return {
    building: { id: building.id, address: building.address, territory_number: building.territory_number, needs_census: building.needs_census, structure_version: building.structure_version },
    units,
    stats: {
      total: units.length,
      available: units.filter((unit) => unit.state === "DISPONIBLE").length,
      revisit: units.filter((unit) => unit.state === "REVISITA").length,
      closed: units.filter((unit) => unit.state === "BLOQUEADO").length,
    },
  };
}
