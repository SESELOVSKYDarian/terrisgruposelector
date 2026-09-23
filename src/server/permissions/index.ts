import "server-only";

import { createAdminSupabaseClient } from "@/lib/server/auth";
import {
  type AppointmentKind,
  type CapabilityKind,
  type GlobalResponsibilityKind,
  type GroupResponsibilityKind,
  type PermissionProfile,
  type ResponsibilityKind,
  isEligibleForResponsibility,
  structuredPermissionsSchema,
} from "@/modules/users/permissions";

export const permissionNames = [
  "MANAGE_USERS",
  "MANAGE_SYSTEM",
  "PLAN_OUTINGS",
  "PUBLISH_OUTINGS",
  "MANAGE_TERRITORIES",
  "VIEW_S13",
  "PUBLISH_ANNOUNCEMENTS",
] as const;

export type PermissionName = (typeof permissionNames)[number];

export type FreshPermissionContext = PermissionProfile & {
  profileId: string;
  globalResponsibilities: GlobalResponsibilityKind[];
  groupResponsibilities: { groupId: string; responsibility: GroupResponsibilityKind }[];
  legacyRoles: string[];
};

function permissionsForResponsibilities(responsibilities: readonly ResponsibilityKind[]) {
  const permissions = new Set<PermissionName>();
  if (responsibilities.includes("COORDINADOR")) permissions.add("MANAGE_USERS");
  if (responsibilities.includes("COORDINADOR")) permissions.add("MANAGE_SYSTEM");
  if (responsibilities.includes("COORDINADOR")) permissions.add("VIEW_S13");
  if (responsibilities.includes("COORDINADOR")) permissions.add("PUBLISH_ANNOUNCEMENTS");
  if (responsibilities.includes("SIERVO_TERRITORIOS")) {
    permissions.add("PLAN_OUTINGS");
    permissions.add("MANAGE_TERRITORIES");
    permissions.add("VIEW_S13");
  }
  if (responsibilities.includes("SUPERINTENDENTE_SERVICIO")) {
    permissions.add("PUBLISH_ANNOUNCEMENTS");
    permissions.add("PUBLISH_OUTINGS");
    permissions.add("MANAGE_TERRITORIES");
    permissions.add("VIEW_S13");
  }
  return permissions;
}

/** A small, serializable projection for navigation. Keep UI visibility based on
 * this server-derived access object rather than on legacy role strings. */
export function navigationAccess(context: FreshPermissionContext) {
  const operationalResponsibilities = new Set<ResponsibilityKind>([
    "COORDINADOR",
    "SUPERINTENDENTE_SERVICIO",
    "SIERVO_TERRITORIOS",
    "SUPERINTENDENTE_GRUPO",
    "AUXILIAR_GRUPO",
  ]);

  return {
    canManageUsers: hasPermission(context, "MANAGE_USERS"),
    canManageSystem: hasPermission(context, "MANAGE_SYSTEM"),
    canManageTerritories: hasPermission(context, "MANAGE_TERRITORIES"),
    canPlanOutings: hasPermission(context, "PLAN_OUTINGS") || hasPermission(context, "PUBLISH_OUTINGS"),
    isConductor: context.capabilities.includes("CONDUCTOR"),
    canPublishAnnouncements: hasPermission(context, "PUBLISH_ANNOUNCEMENTS"),
    canUseReservations:
      context.appointment === "ANCIANO" || context.groupResponsibilities.length > 0,
    hasOperationalResponsibility: [
      ...context.globalResponsibilities,
      ...context.groupResponsibilities.map((assignment) => assignment.responsibility),
    ].some((responsibility) => operationalResponsibilities.has(responsibility)),
  };
}

export function hasPermission(context: FreshPermissionContext, permission: PermissionName) {
  return permissionsForResponsibilities([
    ...context.globalResponsibilities,
    ...context.groupResponsibilities.map((assignment) => assignment.responsibility),
  ]).has(permission);
}

export function assertPermission(context: FreshPermissionContext, permission: PermissionName) {
  if (!hasPermission(context, permission)) throw new Error("No autorizado.");
}

/**
 * Reads the permission model directly from the database. The signed session
 * cookie identifies the caller but is never used as an authorization source.
 */
const contextTtlMs = 2000;
const contextMemo = new Map<string, { at: number; value: Promise<FreshPermissionContext | null> }>();

/** One request calls this from several helpers; the 2s memo collapses them into one read. */
export function getFreshPermissionContext(profileId: string): Promise<FreshPermissionContext | null> {
  const cached = contextMemo.get(profileId);
  if (cached && Date.now() - cached.at < contextTtlMs) return cached.value;
  const value = loadPermissionContext(profileId);
  contextMemo.set(profileId, { at: Date.now(), value });
  value.catch(() => contextMemo.delete(profileId));
  return value;
}

export function invalidatePermissionContext(profileId: string) {
  contextMemo.delete(profileId);
}

async function loadPermissionContext(profileId: string): Promise<FreshPermissionContext | null> {
  const supabase = createAdminSupabaseClient();
  const [profileResult, appointmentResult, capabilityResult, globalResult, groupResult] = await Promise.all([
    supabase.from("profiles").select("id, active, profile_roles(role)").eq("id", profileId).maybeSingle(),
    supabase.from("profile_appointments").select("appointment").eq("profile_id", profileId).maybeSingle(),
    supabase.from("profile_capabilities").select("capability").eq("profile_id", profileId).eq("active", true),
    supabase.from("profile_responsibilities").select("responsibility").eq("profile_id", profileId).is("ended_at", null),
    supabase
      .from("group_responsibility_assignments")
      .select("group_id, responsibility")
      .eq("profile_id", profileId)
      .is("ended_at", null),
  ]);

  const error = [profileResult.error, appointmentResult.error, capabilityResult.error, globalResult.error, groupResult.error].find(Boolean);
  if (error) throw new Error(error.message);
  if (!profileResult.data?.active) return null;

  // legacyRoles is kept only for display (e.g. audit trails, the old "Rol" column) — the Fase-1
  // backfill and the ongoing "Permisos" screen keep V2 authoritative and complete, so nothing here
  // reads it for authorization anymore. The legacy role bridge is retired.
  const legacyRoles = (profileResult.data.profile_roles ?? []).map((entry: { role: string }) => entry.role);
  const appointment = (appointmentResult.data?.appointment ?? "PUBLICADOR") as AppointmentKind;
  const capabilities = (capabilityResult.data ?? []).map((entry) => entry.capability as CapabilityKind);
  const globalResponsibilities = (globalResult.data ?? []).map((entry) => entry.responsibility as GlobalResponsibilityKind);
  const groupResponsibilities = (groupResult.data ?? []).map((entry) => ({
    groupId: entry.group_id,
    responsibility: entry.responsibility as GroupResponsibilityKind,
  }));

  const parsed = structuredPermissionsSchema.safeParse({
    appointment,
    capabilities,
    globalResponsibilities,
    groupResponsibilities,
  });
  if (!parsed.success) throw new Error("El perfil tiene asignaciones de permisos inválidas.");

  return { profileId, legacyRoles, ...parsed.data };
}

export function assertResponsibilityEligibility(profile: PermissionProfile, responsibility: ResponsibilityKind) {
  if (!isEligibleForResponsibility(profile, responsibility)) {
    throw new Error("El perfil no cumple los requisitos de esta responsabilidad.");
  }
}
