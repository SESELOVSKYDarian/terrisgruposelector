import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { addLock, canUndo, canWorkUnit, DEFAULT_LOCK, outcomeFor, unitStatus, validateLockDuration, type ActivityRow, type LockDuration, type UnitStatus } from "@/modules/buildings/activity";
import { formatConductorName } from "@/modules/territories/names";
import { ApiError, forbid } from "@/server/api";
import { writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { canAccessTerritory, type BuildingAccess } from "./access";
import { evaluateRound, reconsiderClosedRound } from "./rounds";

const ACTIVITY_COLUMNS = "id, unit_id, user_id, attended, interested, outcome, worked_at, next_available_at, revisit_active, undone_at, unlocked_at, round_id";

export async function getLockDuration(supabase: AdminSupabase): Promise<LockDuration> {
  const { data, error } = await supabase.from("system_settings").select("value").eq("key", "building_lock").maybeSingle();
  if (error) throw new Error(error.message);
  const parsed = validateLockDuration(data?.value);
  return parsed.ok ? parsed.value : DEFAULT_LOCK;
}

export async function setLockDuration(supabase: AdminSupabase, actorId: string, input: LockDuration) {
  const parsed = validateLockDuration(input);
  if (!parsed.ok) throw new ApiError(parsed.error, 422);
  const before = await getLockDuration(supabase);
  const { error } = await supabase.from("system_settings").upsert({ key: "building_lock", value: parsed.value, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  await writeAudit(supabase, { actorId, action: "BUILDING_LOCK_DURATION_CHANGED", entityType: "system_setting", entityId: null, metadata: { key: "building_lock" }, before, after: parsed.value });
  return parsed.value;
}

/** The building's current round (created on first use). The unique open-round index guards races. */
export async function ensureOpenRound(supabase: AdminSupabase, buildingId: string): Promise<string> {
  const open = async () => (await supabase.from("building_rounds").select("id").eq("building_id", buildingId).is("closed_at", null).maybeSingle()).data?.id as string | undefined;
  const existing = await open();
  if (existing) return existing;
  const { data: last } = await supabase.from("building_rounds").select("round_number").eq("building_id", buildingId).order("round_number", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("building_rounds").insert({ building_id: buildingId, round_number: ((last?.round_number as number | undefined) ?? 0) + 1 }).select("id").single();
  if (error?.code === "23505") {
    const raced = await open();
    if (raced) return raced;
  }
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir la vuelta del edificio.");
  return data.id as string;
}

export type UnitStatusView = UnitStatus & { owner_name: string | null; mine: boolean; can_undo: boolean; can_work: boolean; block_reason: string | null };

/** Per-unit state for a building, from the recorded history (undone marks are ignored). */
export async function loadUnitStatuses(supabase: AdminSupabase, buildingId: string, viewer: SessionProfile, isManager: boolean, now = new Date()) {
  const { data: units, error } = await supabase.from("building_units").select("id").eq("building_id", buildingId).eq("active", true);
  if (error) throw new Error(error.message);
  const unitIds = (units ?? []).map((unit) => unit.id as string);
  const statuses: Record<string, UnitStatusView> = {};
  if (!unitIds.length) return statuses;

  const { data: rows, error: activityError } = await supabase.from("building_unit_activity").select(ACTIVITY_COLUMNS).in("unit_id", unitIds);
  if (activityError) throw new Error(activityError.message);
  const byUnit = new Map<string, ActivityRow[]>();
  for (const row of (rows ?? []) as ActivityRow[]) byUnit.set(row.unit_id, [...(byUnit.get(row.unit_id) ?? []), row]);

  const ownerIds = new Set<string>();
  const computed = unitIds.map((id) => ({ id, activities: byUnit.get(id) ?? [], status: unitStatus(byUnit.get(id) ?? [], now) }));
  for (const entry of computed) if (entry.status.owner_id) ownerIds.add(entry.status.owner_id);
  const { data: owners } = ownerIds.size ? await supabase.from("profiles").select("id, full_name").in("id", [...ownerIds]) : { data: [] };
  const nameOf = (id: string | null) => formatConductorName((owners ?? []).find((owner) => owner.id === id)?.full_name) || null;

  for (const entry of computed) {
    const latest = entry.activities.find((row) => row.id === entry.status.last_activity_id);
    const work = canWorkUnit(entry.status, viewer.id);
    statuses[entry.id] = {
      ...entry.status,
      owner_name: nameOf(entry.status.owner_id),
      mine: entry.status.owner_id === viewer.id,
      can_undo: latest ? canUndo(entry.status, { id: latest.id, user_id: latest.user_id }, viewer.id, isManager) : false,
      can_work: work.ok,
      block_reason: work.ok ? null : work.reason,
    };
  }
  return statuses;
}

async function loadUnitContext(supabase: AdminSupabase, unitId: string) {
  const { data, error } = await supabase.from("building_units").select("id, label, active, building_id, buildings(id, address, territory_id, status)").eq("id", unitId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const building = Array.isArray(data.buildings) ? data.buildings[0] : data.buildings;
  if (!building) return null;
  return { unit: { id: data.id as string, label: data.label as string, active: data.active as boolean }, building: building as { id: string; address: string; territory_id: string; status: string } };
}

async function unitHistory(supabase: AdminSupabase, unitId: string) {
  const { data, error } = await supabase.from("building_unit_activity").select(ACTIVITY_COLUMNS).eq("unit_id", unitId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
}

export type MarkInput = { unit_id: string; attended: boolean; interested?: boolean | null };

/** Records the result of knocking on a doorbell (date, user, building and territory are automatic). */
export async function markUnit(supabase: AdminSupabase, profile: SessionProfile, access: BuildingAccess, input: MarkInput, now = new Date()) {
  const context = await loadUnitContext(supabase, input.unit_id);
  if (!context || !canAccessTerritory(access, context.building.territory_id)) throw new ApiError("Departamento no encontrado.", 404);
  if (!context.unit.active || context.building.status !== "ACTIVE") throw new ApiError("Ese departamento ya no está activo.", 409);
  if (!input.attended && input.interested) throw new ApiError("No se puede mostrar interés sin haber sido atendido.", 422);

  const history = await unitHistory(supabase, input.unit_id);
  const status = unitStatus(history, now);
  const work = canWorkUnit(status, profile.id);
  if (!work.ok) {
    const until = status.blocked_until ? new Date(status.blocked_until).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : null;
    throw new ApiError(status.state === "REVISITA" ? `${work.reason}` : `${work.reason}${until ? ` Vuelve a estar disponible el ${until}.` : ""}`, 409);
  }

  const outcome = outcomeFor(input.attended, input.interested);
  const roundId = await ensureOpenRound(supabase, context.building.id);
  const lock = await getLockDuration(supabase);
  const { data, error } = await supabase
    .from("building_unit_activity")
    .insert({ building_id: context.building.id, unit_id: context.unit.id, round_id: roundId, user_id: profile.id, attended: input.attended, interested: input.attended ? Boolean(input.interested) : null, outcome, worked_at: now.toISOString(), next_available_at: outcome === "TRABAJADO" ? addLock(now, lock).toISOString() : null, revisit_active: outcome === "REVISITA" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo registrar el resultado.");

  // Working your own revisita again replaces it: the old one is released, history is kept.
  const previous = status.state === "REVISITA" && status.last_activity_id ? status.last_activity_id : null;
  if (previous) await supabase.from("building_unit_activity").update({ revisit_active: false, revisit_released_at: now.toISOString(), revisit_released_by: profile.id }).eq("id", previous);

  await writeAudit(supabase, { actorId: profile.id, action: outcome === "REVISITA" ? "UNIT_REVISIT_MARKED" : "UNIT_WORKED", entityType: "building_unit", entityId: context.unit.id, metadata: { building_id: context.building.id, territory_id: context.building.territory_id, round_id: roundId, unit: context.unit.label }, after: { attended: input.attended, interested: input.attended ? Boolean(input.interested) : null, outcome } });
  // The mark may complete the building's round (every doorbell done): close it and open the next.
  const evaluation = await evaluateRound(supabase, context.building.id, profile.id, now);
  return { id: data.id as string, outcome, round_id: roundId, building_id: context.building.id, round_closed: evaluation.closed };
}

/** Undo keeps the row (undone_at/by) so the history explains what happened. */
export async function undoActivity(supabase: AdminSupabase, profile: SessionProfile, access: BuildingAccess, input: { id: string; reason?: string | null }, now = new Date()) {
  const { data: row, error } = await supabase.from("building_unit_activity").select(`${ACTIVITY_COLUMNS}, building_id`).eq("id", input.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.undone_at) throw new ApiError("Registro no encontrado.", 404);
  const context = await loadUnitContext(supabase, row.unit_id as string);
  if (!context || !canAccessTerritory(access, context.building.territory_id)) throw new ApiError("Registro no encontrado.", 404);
  const status = unitStatus(await unitHistory(supabase, row.unit_id as string), now);
  if (!canUndo(status, { id: row.id as string, user_id: row.user_id as string | null }, profile.id, access.canManage)) forbid("Solo podés deshacer tu último registro de ese departamento.");
  const { error: updateError } = await supabase.from("building_unit_activity").update({ undone_at: now.toISOString(), undone_by: profile.id, undo_reason: input.reason || null }).eq("id", input.id).is("undone_at", null);
  if (updateError) throw new Error(updateError.message);
  await writeAudit(supabase, { actorId: profile.id, action: "UNIT_MARK_UNDONE", entityType: "building_unit", entityId: context.unit.id, metadata: { building_id: context.building.id, activity_id: input.id, reason: input.reason ?? null, by_manager: access.canManage && row.user_id !== profile.id } });
  // If the undone mark had closed the round, reopen it (unless the next round already has marks).
  const reconsidered = await reconsiderClosedRound(supabase, context.building.id, (row.round_id as string | null) ?? null, profile.id, now);
  return { building_id: context.building.id, round_reopened: reconsidered.reopened, round_reopen_blocked: reconsidered.blocked };
}

/** "Quitar revisita": the owner (or a manager) frees the doorbell again. */
export async function releaseRevisit(supabase: AdminSupabase, profile: SessionProfile, access: BuildingAccess, unitId: string, now = new Date()) {
  const context = await loadUnitContext(supabase, unitId);
  if (!context || !canAccessTerritory(access, context.building.territory_id)) throw new ApiError("Departamento no encontrado.", 404);
  const status = unitStatus(await unitHistory(supabase, unitId), now);
  if (status.state !== "REVISITA" || !status.last_activity_id) throw new ApiError("Ese departamento no tiene una revisita activa.", 409);
  if (status.owner_id !== profile.id && !access.canManage) forbid("Solo quien marcó la revisita (o un responsable) puede quitarla.");
  const { error } = await supabase.from("building_unit_activity").update({ revisit_active: false, revisit_released_at: now.toISOString(), revisit_released_by: profile.id }).eq("id", status.last_activity_id);
  if (error) throw new Error(error.message);
  await writeAudit(supabase, { actorId: profile.id, action: "UNIT_REVISIT_RELEASED", entityType: "building_unit", entityId: unitId, metadata: { building_id: context.building.id, owner_id: status.owner_id } });
  return { building_id: context.building.id };
}

export type UnlockScope = "UNIT" | "BUILDING" | "TERRITORY";

/** Servicio/Territorios clear temporary locks and held revisitas for a unit, a building or a whole territory. */
export async function unlockUnits(supabase: AdminSupabase, profile: SessionProfile, input: { scope: UnlockScope; id: string }, now = new Date()) {
  let buildingIds: string[] = [];
  let unitFilter: string[] | null = null;
  if (input.scope === "UNIT") {
    const context = await loadUnitContext(supabase, input.id);
    if (!context) throw new ApiError("Departamento no encontrado.", 404);
    buildingIds = [context.building.id];
    unitFilter = [input.id];
  } else if (input.scope === "BUILDING") {
    buildingIds = [input.id];
  } else {
    const { data, error } = await supabase.from("buildings").select("id").eq("territory_id", input.id);
    if (error) throw new Error(error.message);
    buildingIds = (data ?? []).map((row) => row.id as string);
  }
  if (!buildingIds.length) return { unlocked: 0 };

  let query = supabase.from("building_unit_activity").update({ unlocked_at: now.toISOString(), unlocked_by: profile.id }).in("building_id", buildingIds).is("undone_at", null).is("unlocked_at", null).or(`next_available_at.gt.${now.toISOString()},revisit_active.eq.true`);
  if (unitFilter) query = query.in("unit_id", unitFilter);
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  const count = data?.length ?? 0;
  await writeAudit(supabase, { actorId: profile.id, action: "UNITS_UNLOCKED", entityType: input.scope === "TERRITORY" ? "territory" : input.scope === "BUILDING" ? "building" : "building_unit", entityId: input.id, metadata: { scope: input.scope, buildings: buildingIds.length, activities: count } });
  return { unlocked: count };
}
