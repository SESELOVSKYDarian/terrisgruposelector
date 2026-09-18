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
  mapLegacyRolesToStructuredPermissions,
  structuredPermissionsSchema,
} from "@/modules/users/permissions";

export const permissionNames = [
  "MANAGE_USERS",
  "PLAN_OUTINGS",
  "PUBLISH_OUTINGS",
  "MANAGE_TERRITORIES",
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
  if (responsibilities.includes("SIERVO_TERRITORIOS")) {
    permissions.add("PLAN_OUTINGS");
    permissions.add("MANAGE_TERRITORIES");
  }
  if (responsibilities.includes("SUPERINTENDENTE_SERVICIO")) permissions.add("PUBLISH_OUTINGS");
  return permissions;
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
export async function getFreshPermissionContext(profileId: string): Promise<FreshPermissionContext | null> {
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

  const legacyRoles = (profileResult.data.profile_roles ?? []).map((entry: { role: string }) => entry.role);
  const fallback = mapLegacyRolesToStructuredPermissions(
    legacyRoles.filter((role): role is "ADMIN" | "ANCIANO" | "CONDUCTOR" | "PUBLICADOR" =>
      ["ADMIN", "ANCIANO", "CONDUCTOR", "PUBLICADOR"].includes(role),
    ),
  );
  const appointment = (appointmentResult.data?.appointment ?? fallback.appointment) as AppointmentKind;
  // ADMIN remains a compatibility bridge until V1 is retired. Merge it with
  // persisted V2 rows so a legacy-created super-admin cannot lose access
  // between creating the account and a later backfill/reconciliation run.
  const capabilities = [...new Set([
    ...(capabilityResult.data ?? []).map((entry) => entry.capability as CapabilityKind),
    ...fallback.capabilities,
  ])];
  const globalResponsibilities = [...new Set([
    ...(globalResult.data ?? []).map((entry) => entry.responsibility as GlobalResponsibilityKind),
    ...fallback.globalResponsibilities,
  ])];
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
