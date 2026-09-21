import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { applyDiff, censusReasons, parseDiffOps, type CensusReason, type DiffOp } from "@/modules/buildings/structure";
import { ApiError } from "@/server/api";
import { resolveTerritoryManagerIds, safeEmit, writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { canAccessTerritory, type BuildingAccess } from "./access";
import { loadBuilding, saveStructure } from "./index";

export type CensusInput = { building_id: string; base_version: number; reason: CensusReason; description?: string | null; photo_data?: string | null; diff?: unknown };

const PHOTO_PREFIX = "data:image/jpeg;base64,";
const MAX_PHOTO_LENGTH = 900000;

/** Anyone working/consulting the territory reports that a building still needs to be censused. */
export async function reportMissingCensus(supabase: AdminSupabase, profile: SessionProfile, access: BuildingAccess, input: CensusInput) {
  const building = await loadBuilding(supabase, input.building_id);
  if (!building || !canAccessTerritory(access, building.territory_id)) throw new ApiError("Edificio no encontrado.", 404);
  if (!censusReasons.includes(input.reason)) throw new ApiError("Motivo inválido.", 422);
  if (input.base_version !== building.structure_version) throw new ApiError("El edificio cambió mientras lo mirabas. Recargalo antes de informar.", 409);

  const description = (input.description ?? "").trim();
  if (input.reason === "OTRO" && !description) throw new ApiError("Contanos qué pasa con el edificio.", 422);
  if (description.length > 1500) throw new ApiError("La descripción es demasiado larga.", 422);
  if (input.photo_data && (!input.photo_data.startsWith(PHOTO_PREFIX) || input.photo_data.length > MAX_PHOTO_LENGTH)) throw new ApiError("La foto debe ser un JPEG de hasta unos 600 KB.", 422);

  let diff: DiffOp[] | null = null;
  if (input.diff !== undefined && input.diff !== null) {
    const parsed = parseDiffOps(input.diff);
    if (!parsed.ok) throw new ApiError(parsed.error, 422);
    // A stored proposal must be applicable to the structure it was made on.
    const trial = applyDiff(building.units, parsed.ops);
    if (!trial.ok) throw new ApiError(`La propuesta no se puede aplicar: ${trial.error}`, 422);
    diff = parsed.ops.length ? parsed.ops : null;
  }

  const { data, error } = await supabase
    .from("building_census_reports")
    .insert({ building_id: building.id, territory_id: building.territory_id, reporter_id: profile.id, reason: input.reason, description: description || null, photo_data: input.photo_data || null, diff, base_version: building.structure_version })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo registrar el informe.");
  await writeAudit(supabase, { actorId: profile.id, action: "BUILDING_CENSUS_REPORTED", entityType: "building_census_report", entityId: data.id, metadata: { building_id: building.id, reason: input.reason, has_diff: Boolean(diff), has_photo: Boolean(input.photo_data) } });

  const title = `${profile.full_name} informa que falta censar ${building.address} (Territorio ${building.territory_number}).`;
  for (const recipientId of await resolveTerritoryManagerIds(supabase)) {
    if (recipientId === profile.id) continue;
    await safeEmit({ type: "BUILDING_CENSUS_CORRECTION", naturalKey: `building-census:${data.id}:${recipientId}`, actorId: profile.id, payload: { recipientId, correctionId: data.id, title } });
  }
  return { id: data.id as string };
}

/** Pending reports for managers (photo is fetched separately to keep the list light). */
export async function listPendingCensus(supabase: AdminSupabase) {
  const { data, error } = await supabase
    .from("building_census_reports")
    .select("id, building_id, reason, description, diff, base_version, created_at, photo_data, buildings(address, structure_version, territories(number)), profiles!reporter_id(full_name)")
    .eq("status", "PENDING")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const building = Array.isArray(row.buildings) ? row.buildings[0] : row.buildings;
    const territory = building ? (Array.isArray(building.territories) ? building.territories[0] : building.territories) : null;
    const reporter = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id as string,
      building_id: row.building_id as string,
      address: (building as { address?: string } | null)?.address ?? "",
      territory_number: (territory as { number?: number } | null)?.number ?? 0,
      reason: row.reason as CensusReason,
      description: row.description as string | null,
      diff: (row.diff as DiffOp[] | null) ?? null,
      base_version: row.base_version as number,
      current_version: (building as { structure_version?: number } | null)?.structure_version ?? row.base_version,
      has_photo: Boolean(row.photo_data),
      reporter: (reporter as { full_name?: string } | null)?.full_name ?? null,
      created_at: row.created_at as string,
    };
  });
}

export async function censusPhoto(supabase: AdminSupabase, reportId: string) {
  const { data, error } = await supabase.from("building_census_reports").select("photo_data").eq("id", reportId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.photo_data as string | null) ?? null;
}

/**
 * "Aplicar corrección": only when the building is still on the version the reporter saw.
 * The write (structure + version snapshot + report → APPLIED) happens in one SQL transaction;
 * on any conflict nothing is overwritten and the manager is told to review it by hand.
 */
export async function applyCensusCorrection(supabase: AdminSupabase, profile: SessionProfile, reportId: string) {
  const { data: report, error } = await supabase.from("building_census_reports").select("id, building_id, diff, base_version, status").eq("id", reportId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!report) throw new ApiError("Informe no encontrado.", 404);
  if (report.status !== "PENDING") throw new ApiError("Ese informe ya fue resuelto.", 409);
  const building = await loadBuilding(supabase, report.building_id as string);
  if (!building) throw new ApiError("Edificio no encontrado.", 404);
  if (!report.diff) throw new ApiError("Este informe no trae una propuesta estructurada: abrí el editor con la evidencia.", 422);
  if (report.base_version !== building.structure_version) {
    throw new ApiError(`Conflicto: el edificio pasó de la versión ${report.base_version} a la ${building.structure_version} desde que se informó. No se aplicó nada; revisalo en el editor.`, 409);
  }
  const parsed = parseDiffOps(report.diff);
  if (!parsed.ok) throw new ApiError(parsed.error, 422);
  const next = applyDiff(building.units, parsed.ops);
  if (!next.ok) throw new ApiError(`La propuesta ya no se puede aplicar: ${next.error}`, 409);
  try {
    const saved = await saveStructure(supabase, profile.id, { building_id: building.id, expected_version: building.structure_version, units: next.units, report_id: reportId });
    await writeAudit(supabase, { actorId: profile.id, action: "BUILDING_CENSUS_APPLIED", entityType: "building_census_report", entityId: reportId, metadata: { building_id: building.id, version: saved.version }, before: { version: building.structure_version }, after: { version: saved.version } });
    return saved;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("REPORT_NOT_PENDING")) throw new ApiError("Otra persona ya resolvió ese informe.", 409);
    throw cause;
  }
}

export async function dismissCensus(supabase: AdminSupabase, profile: SessionProfile, input: { id: string; note?: string | null }) {
  const { data, error } = await supabase.from("building_census_reports").update({ status: "DISMISSED", decided_by: profile.id, decided_at: new Date().toISOString(), decision_note: input.note || null }).eq("id", input.id).eq("status", "PENDING").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ApiError("Informe no encontrado o ya resuelto.", 404);
  await writeAudit(supabase, { actorId: profile.id, action: "BUILDING_CENSUS_DISMISSED", entityType: "building_census_report", entityId: input.id });
  return {};
}
