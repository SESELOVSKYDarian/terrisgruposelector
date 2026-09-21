import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { autoLayout, validateUnits, type Unit } from "@/modules/buildings/structure";
import { ApiError } from "@/server/api";
import { resolveTerritoryManagerIds, safeEmit, writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { evaluateRound } from "./rounds";

export type BuildingListItem = { id: string; territory_id: string; territory_number: number; address: string; status: string; structure_version: number; unit_count: number };

/** Buildings the caller may see (null territoryIds = every territory), optionally filtered by text/territory. */
export async function listBuildings(supabase: AdminSupabase, options: { territoryIds: Set<string> | null; territoryId?: string; q?: string }): Promise<BuildingListItem[]> {
  let query = supabase.from("buildings").select("id, territory_id, address, status, structure_version, territories(number), building_units(id, active)").order("address");
  if (options.territoryId) query = query.eq("territory_id", options.territoryId);
  if (options.territoryIds) {
    if (!options.territoryIds.size) return [];
    query = query.in("territory_id", [...options.territoryIds]);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const term = (options.q ?? "").trim().toLowerCase();
  return (data ?? [])
    .map((row) => {
      const territory = Array.isArray(row.territories) ? row.territories[0] : row.territories;
      return {
        id: row.id as string,
        territory_id: row.territory_id as string,
        territory_number: (territory as { number?: number } | null)?.number ?? 0,
        address: row.address as string,
        status: row.status as string,
        structure_version: row.structure_version as number,
        unit_count: ((row.building_units as { active: boolean }[] | null) ?? []).filter((unit) => unit.active).length,
      };
    })
    .filter((item) => !term || item.address.toLowerCase().includes(term) || `territorio ${item.territory_number}`.includes(term))
    .sort((a, b) => a.territory_number - b.territory_number || a.address.localeCompare(b.address));
}

export async function loadBuilding(supabase: AdminSupabase, buildingId: string) {
  const { data, error } = await supabase.from("buildings").select("id, territory_id, address, status, structure_version, territories(number, name)").eq("id", buildingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: units, error: unitsError } = await supabase.from("building_units").select("id, label, row_index, col_index").eq("building_id", buildingId).eq("active", true).order("row_index").order("col_index");
  if (unitsError) throw new Error(unitsError.message);
  const territory = Array.isArray(data.territories) ? data.territories[0] : data.territories;
  return {
    id: data.id as string,
    territory_id: data.territory_id as string,
    territory_number: (territory as { number?: number } | null)?.number ?? 0,
    address: data.address as string,
    status: data.status as string,
    structure_version: data.structure_version as number,
    units: (units ?? []).map((unit) => ({ id: unit.id as string, label: unit.label as string, row: unit.row_index as number, col: unit.col_index as number })) as Unit[],
  };
}

/** Creates an official building with its first structure (version 1). Cleans up on failure. */
export async function createBuilding(supabase: AdminSupabase, input: { territory_id: string; address: string; labels?: string[]; columns?: number; actorId: string }) {
  const address = input.address.trim().replace(/\s+/g, " ");
  const { data: territory } = await supabase.from("territories").select("id").eq("id", input.territory_id).eq("active", true).maybeSingle();
  if (!territory) throw new ApiError("Territorio no encontrado.", 404);

  const layout = validateUnits(autoLayout(input.labels ?? [], input.columns ?? 2));
  if (!layout.ok) throw new ApiError(layout.error, 422);

  const { data: building, error } = await supabase.from("buildings").insert({ territory_id: input.territory_id, address, created_by: input.actorId }).select("id").single();
  if (error?.code === "23505") throw new ApiError("Ese edificio ya existe en el territorio.", 409);
  if (error || !building) throw new Error(error?.message ?? "No se pudo crear el edificio.");
  try {
    if (layout.units.length) {
      const { error: unitsError } = await supabase.from("building_units").insert(layout.units.map((unit) => ({ building_id: building.id, label: unit.label, row_index: unit.row, col_index: unit.col })));
      if (unitsError) throw new Error(unitsError.message);
    }
    const { data: stored } = await supabase.from("building_units").select("id, label, row_index, col_index").eq("building_id", building.id).eq("active", true);
    const { error: versionError } = await supabase.from("building_versions").insert({ building_id: building.id, version: 1, units: (stored ?? []).map((unit) => ({ id: unit.id, label: unit.label, row: unit.row_index, col: unit.col_index })), changed_by: input.actorId });
    if (versionError) throw new Error(versionError.message);
  } catch (cause) {
    await supabase.from("buildings").delete().eq("id", building.id);
    throw cause;
  }
  await writeAudit(supabase, { actorId: input.actorId, action: "BUILDING_CREATED", entityType: "building", entityId: building.id, metadata: { territory_id: input.territory_id }, after: { address, units: layout.units.length } });
  return building.id as string;
}

/** Someone working the territory reports a building; Servicio/Territorios approve or reject it. */
export async function proposeBuilding(supabase: AdminSupabase, profile: SessionProfile, input: { territory_id: string; address: string }) {
  const address = input.address.trim().replace(/\s+/g, " ");
  const { data: existing } = await supabase.from("buildings").select("id").eq("territory_id", input.territory_id).ilike("address", address).eq("status", "ACTIVE").maybeSingle();
  if (existing) throw new ApiError("Ese edificio ya existe en el territorio.", 409);
  const { data: pending } = await supabase.from("building_proposals").select("id").eq("territory_id", input.territory_id).eq("status", "PENDING").ilike("address", address).maybeSingle();
  if (pending) throw new ApiError("Ya hay una propuesta pendiente para ese edificio.", 409);
  const { data: territory } = await supabase.from("territories").select("number").eq("id", input.territory_id).maybeSingle();
  const { data, error } = await supabase.from("building_proposals").insert({ territory_id: input.territory_id, address, proposed_by: profile.id }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo registrar la propuesta.");
  await writeAudit(supabase, { actorId: profile.id, action: "BUILDING_PROPOSED", entityType: "building_proposal", entityId: data.id, metadata: { territory_id: input.territory_id }, after: { address } });
  for (const recipientId of await resolveTerritoryManagerIds(supabase)) {
    if (recipientId === profile.id) continue;
    await safeEmit({ type: "BUILDING_PROPOSED", naturalKey: `building-proposal:${data.id}:${recipientId}`, actorId: profile.id, payload: { recipientId, proposalId: data.id, title: `${profile.full_name} propone un edificio: ${address} (Territorio ${territory?.number ?? "?"}).` } });
  }
  return { id: data.id as string };
}

export async function decideProposal(supabase: AdminSupabase, profile: SessionProfile, input: { id: string; approve: boolean; note?: string | null }) {
  const { data: proposal, error } = await supabase.from("building_proposals").select("id, territory_id, address, status, proposed_by").eq("id", input.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) throw new ApiError("Propuesta no encontrada.", 404);
  if (proposal.status !== "PENDING") throw new ApiError("Esa propuesta ya fue resuelta.", 409);
  const buildingId = input.approve ? await createBuilding(supabase, { territory_id: proposal.territory_id as string, address: proposal.address as string, actorId: profile.id }) : null;
  // Matching on PENDING makes two managers deciding at once resolve cleanly (the second one loses).
  const { data: decided, error: decideError } = await supabase.from("building_proposals").update({ status: input.approve ? "APPROVED" : "REJECTED", decided_by: profile.id, decided_at: new Date().toISOString(), decision_note: input.note || null, building_id: buildingId }).eq("id", input.id).eq("status", "PENDING").select("id");
  if (decideError) throw new Error(decideError.message);
  if (!decided?.length) throw new ApiError("Otra persona ya resolvió esa propuesta.", 409);
  await writeAudit(supabase, { actorId: profile.id, action: input.approve ? "BUILDING_PROPOSAL_APPROVED" : "BUILDING_PROPOSAL_REJECTED", entityType: "building_proposal", entityId: input.id, metadata: { building_id: buildingId }, after: { address: proposal.address } });
  return { building_id: buildingId };
}

/** Atomic structure replacement on the version the caller saw (see replace_building_structure). */
export async function saveStructure(supabase: AdminSupabase, actorId: string, input: { building_id: string; expected_version: number; units: Unit[]; report_id?: string | null }) {
  const validated = validateUnits(input.units);
  if (!validated.ok) throw new ApiError(validated.error, 422);
  const { data: existing } = await supabase.from("building_units").select("id").eq("building_id", input.building_id);
  const known = new Set((existing ?? []).map((unit) => unit.id as string));
  if (validated.units.some((unit) => unit.id && !known.has(unit.id))) throw new ApiError("Hay timbres que no pertenecen a este edificio.", 422);

  const { data, error } = await supabase.rpc("replace_building_structure", { p_building_id: input.building_id, p_expected_version: input.expected_version, p_units: validated.units.map((unit) => ({ id: unit.id, label: unit.label, row: unit.row, col: unit.col })), p_actor: actorId, p_report_id: input.report_id ?? null });
  if (error) {
    if (error.message.includes("VERSION_CONFLICT")) throw new ApiError("El edificio cambió mientras lo editabas. Recargá y revisá los cambios: no se sobrescribió nada.", 409);
    if (error.message.includes("BUILDING_NOT_FOUND")) throw new ApiError("Edificio no encontrado.", 404);
    if (error.code === "23505") throw new ApiError("Hay timbres con el mismo nombre o la misma posición.", 409);
    throw new Error(error.message);
  }
  await writeAudit(supabase, { actorId, action: "BUILDING_STRUCTURE_SAVED", entityType: "building", entityId: input.building_id, metadata: { version: data, report_id: input.report_id ?? null }, after: { units: validated.units.length } });
  // Removing doorbells can complete the current round; a round-evaluation hiccup never undoes the save.
  try {
    await evaluateRound(supabase, input.building_id, actorId);
  } catch (roundError) {
    console.warn("No se pudo reevaluar la vuelta del edificio:", roundError);
  }
  return { version: data as number };
}
