import "server-only";

import { createAdminSupabaseClient, type SessionProfile } from "@/lib/server/auth";
import { emitDomainEvent, type DomainEventInput, type DomainEventType } from "@/server/events";
import { derivePlanningAuthority, isPlanningStatus, type PlanningAuthority, type PlanningStatus } from "@/modules/outings/workflow";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";

export type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

const NO_AUTHORITY: PlanningAuthority = { canPlan: false, canPublish: false };

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

async function activeProfileIds(supabase: AdminSupabase, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id").in("id", ids).eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id as string);
}

async function holdersOf(supabase: AdminSupabase, responsibility: "SIERVO_TERRITORIOS" | "SUPERINTENDENTE_SERVICIO") {
  const { data, error } = await supabase
    .from("profile_responsibilities")
    .select("profile_id")
    .eq("responsibility", responsibility)
    .is("ended_at", null);
  if (error) throw new Error(error.message);
  return activeProfileIds(supabase, unique((data ?? []).map((row) => row.profile_id as string)));
}

/**
 * Planning authority is always derived from the database, never from the client.
 * Legacy ADMIN bridges a permission only while nobody holds the V2 responsibility.
 */
export async function getPlanningAuthority(profile: SessionProfile): Promise<PlanningAuthority> {
  const isLegacyAdmin = profile.roles.includes("ADMIN");
  try {
    const context = await getFreshPermissionContext(profile.id);
    if (!context) return NO_AUTHORITY;
    const hasPlanPermission = hasPermission(context, "PLAN_OUTINGS");
    const hasPublishPermission = hasPermission(context, "PUBLISH_OUTINGS");
    if (!isLegacyAdmin) return { canPlan: hasPlanPermission, canPublish: hasPublishPermission };
    const supabase = createAdminSupabaseClient();
    const [planHolders, publishHolders] = await Promise.all([holdersOf(supabase, "SIERVO_TERRITORIOS"), holdersOf(supabase, "SUPERINTENDENTE_SERVICIO")]);
    return derivePlanningAuthority({ hasPlanPermission, hasPublishPermission, isLegacyAdmin, planHeldByAnyone: planHolders.length > 0, publishHeldByAnyone: publishHolders.length > 0 });
  } catch (error) {
    // V2 permission tables not migrated yet: nobody can hold V2 responsibilities,
    // so legacy ADMIN keeps the planning ability it always had.
    console.warn("No se pudo leer el modelo de permisos V2; se usa el puente legacy.", error);
    return isLegacyAdmin ? { canPlan: true, canPublish: true } : NO_AUTHORITY;
  }
}

/** Reviewers: Superintendentes de Servicio, or legacy admins while none is assigned. */
export async function resolveReviewerIds(supabase: AdminSupabase) {
  try {
    const holders = await holdersOf(supabase, "SUPERINTENDENTE_SERVICIO");
    if (holders.length) return holders;
  } catch (error) {
    console.warn("No se pudieron leer los Superintendentes de Servicio V2.", error);
  }
  const { data, error } = await supabase.from("profile_roles").select("profile_id").eq("role", "ADMIN");
  if (error) throw new Error(error.message);
  return activeProfileIds(supabase, unique((data ?? []).map((row) => row.profile_id as string)));
}

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
};

/** Best effort: a missing audit table (migration pending) must not undo an already applied change. */
export async function writeAudit(supabase: AdminSupabase, entry: AuditEntry) {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    metadata: entry.metadata ?? {},
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) console.error(`No se pudo registrar la auditoría ${entry.action}:`, error.message);
}

/** Notifications never fail the planning mutation that triggered them. */
export async function safeEmit<T extends DomainEventType>(input: DomainEventInput<T>) {
  try {
    await emitDomainEvent(input);
  } catch (error) {
    console.warn(`No se pudo emitir ${input.type}:`, error);
  }
}

export type WeekRow = {
  id: string;
  starts_on: string;
  status: PlanningStatus;
  created_by: string | null;
  submitted_by: string | null;
};

/** Rows created before the Fase 6 migration have no status column: they were already the live plan. */
export async function loadWeek(supabase: AdminSupabase, weekId: string): Promise<WeekRow | null> {
  const { data, error } = await supabase.from("weekly_outings").select("*").eq("id", weekId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    starts_on: data.starts_on,
    status: isPlanningStatus(data.status) ? data.status : "PUBLISHED",
    created_by: data.created_by ?? null,
    submitted_by: data.submitted_by ?? null,
  };
}

export type ConductorOption = { id: string; full_name: string; group_id: string | null };

/**
 * Profiles with the CONDUCTOR characteristic (V2 capability, or legacy CONDUCTOR/ADMIN role
 * while V1 still exists). Optionally restricted to one group.
 */
export async function listConductors(supabase: AdminSupabase, options: { groupId?: string } = {}): Promise<ConductorOption[]> {
  const ids = new Set<string>();
  const capabilities = await supabase.from("profile_capabilities").select("profile_id").eq("capability", "CONDUCTOR").eq("active", true);
  if (!capabilities.error) for (const row of capabilities.data ?? []) ids.add(row.profile_id as string);
  if (!ids.size) return [];
  let query = supabase.from("profiles").select("id, full_name, group_id").in("id", [...ids]).eq("active", true).order("full_name");
  if (options.groupId) query = query.eq("group_id", options.groupId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ConductorOption[];
}

export async function isEligibleConductor(supabase: AdminSupabase, profileId: string, groupId?: string) {
  return (await listConductors(supabase, { groupId })).some((conductor) => conductor.id === profileId);
}

/** Siervos de Territorios (they receive submitted reports); falls back to the reviewers while none is assigned. */
export async function resolvePlannerIds(supabase: AdminSupabase) {
  try {
    const holders = await holdersOf(supabase, "SIERVO_TERRITORIOS");
    if (holders.length) return holders;
  } catch (error) {
    console.warn("No se pudieron leer los Siervos de Territorios V2.", error);
  }
  return resolveReviewerIds(supabase);
}

/** Superintendente de Servicio + Siervo de Territorios (who approve buildings, census fixes, unlocks). */
export async function resolveTerritoryManagerIds(supabase: AdminSupabase) {
  const ids = new Set<string>();
  for (const responsibility of ["SIERVO_TERRITORIOS", "SUPERINTENDENTE_SERVICIO"] as const) {
    try {
      for (const id of await holdersOf(supabase, responsibility)) ids.add(id);
    } catch (error) {
      console.warn(`No se pudieron leer los titulares de ${responsibility}.`, error);
    }
  }
  if (ids.size) return [...ids];
  return resolveReviewerIds(supabase);
}
