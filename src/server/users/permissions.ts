import "server-only";

import {
  capabilityKinds,
  globalResponsibilityKinds,
  structuredPermissionsSchema,
  type CapabilityKind,
  type GlobalResponsibilityKind,
  type StructuredPermissions,
} from "@/modules/users/permissions";
import { writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { ApiError } from "@/server/api";

/** The raw, persisted V2 state for one profile — not merged with the legacy-role fallback (that
 * merge is for authorization; here we want to show/edit exactly what's stored). */
export async function getStructuredPermissions(supabase: AdminSupabase, profileId: string): Promise<StructuredPermissions> {
  const [appointmentResult, capabilityResult, globalResult, groupResult] = await Promise.all([
    supabase.from("profile_appointments").select("appointment").eq("profile_id", profileId).maybeSingle(),
    supabase.from("profile_capabilities").select("capability").eq("profile_id", profileId).eq("active", true),
    supabase.from("profile_responsibilities").select("responsibility").eq("profile_id", profileId).is("ended_at", null),
    supabase.from("group_responsibility_assignments").select("group_id, responsibility").eq("profile_id", profileId).is("ended_at", null),
  ]);
  const error = [appointmentResult.error, capabilityResult.error, globalResult.error, groupResult.error].find(Boolean);
  if (error) throw new Error(error.message);
  return {
    appointment: (appointmentResult.data?.appointment as StructuredPermissions["appointment"]) ?? "PUBLICADOR",
    capabilities: (capabilityResult.data ?? []).map((row) => row.capability as CapabilityKind),
    globalResponsibilities: (globalResult.data ?? []).map((row) => row.responsibility as GlobalResponsibilityKind),
    groupResponsibilities: (groupResult.data ?? []).map((row) => ({ groupId: row.group_id as string, responsibility: row.responsibility as StructuredPermissions["groupResponsibilities"][number]["responsibility"] })),
  };
}

/**
 * Applies the desired condición/características/responsabilidades for one profile: updates the
 * appointment, activates/deactivates capabilities, opens/closes responsibility rows. Eligibility
 * is checked here (clear error before touching anything) and again by the database triggers
 * (defense in depth). Every change is audited; legacy profile_roles/profiles.role are untouched.
 */
export async function setStructuredPermissions(supabase: AdminSupabase, actorId: string, profileId: string, input: unknown) {
  const parsed = structuredPermissionsSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "Los permisos no son válidos.", 422);
  const desired = parsed.data;
  const before = await getStructuredPermissions(supabase, profileId);
  const now = new Date().toISOString();

  if (desired.appointment !== before.appointment) {
    const { error } = await supabase.from("profile_appointments").update({ appointment: desired.appointment, assigned_by: actorId, updated_at: now }).eq("profile_id", profileId);
    if (error) throw new Error(error.message);
  }

  for (const capability of capabilityKinds) {
    const wants = desired.capabilities.includes(capability);
    const had = before.capabilities.includes(capability);
    if (wants === had) continue;
    if (wants) {
      const { error } = await supabase.from("profile_capabilities").upsert({ profile_id: profileId, capability, active: true, revoked_at: null, assigned_by: actorId, granted_at: now, updated_at: now }, { onConflict: "profile_id,capability" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("profile_capabilities").update({ active: false, revoked_at: now, updated_at: now }).eq("profile_id", profileId).eq("capability", capability);
      if (error) throw new Error(error.message);
    }
  }

  for (const responsibility of globalResponsibilityKinds) {
    const wants = desired.globalResponsibilities.includes(responsibility);
    const had = before.globalResponsibilities.includes(responsibility);
    if (wants === had) continue;
    if (wants) {
      const { error } = await supabase.from("profile_responsibilities").insert({ profile_id: profileId, responsibility, assigned_by: actorId });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("profile_responsibilities").update({ ended_at: now }).eq("profile_id", profileId).eq("responsibility", responsibility).is("ended_at", null);
      if (error) throw new Error(error.message);
    }
  }

  const beforeGroupKeys = new Set(before.groupResponsibilities.map((entry) => `${entry.groupId}:${entry.responsibility}`));
  const desiredGroupKeys = new Set(desired.groupResponsibilities.map((entry) => `${entry.groupId}:${entry.responsibility}`));
  for (const entry of before.groupResponsibilities) {
    const key = `${entry.groupId}:${entry.responsibility}`;
    if (desiredGroupKeys.has(key)) continue;
    const { error } = await supabase.from("group_responsibility_assignments").update({ ended_at: now }).eq("profile_id", profileId).eq("group_id", entry.groupId).eq("responsibility", entry.responsibility).is("ended_at", null);
    if (error) throw new Error(error.message);
  }
  for (const entry of desired.groupResponsibilities) {
    const key = `${entry.groupId}:${entry.responsibility}`;
    if (beforeGroupKeys.has(key)) continue;
    const { error } = await supabase.from("group_responsibility_assignments").insert({ group_id: entry.groupId, profile_id: profileId, responsibility: entry.responsibility, assigned_by: actorId });
    if (error) throw new Error(error.message);
  }

  await writeAudit(supabase, { actorId, action: "USER_PERMISSIONS_UPDATED", entityType: "profile", entityId: profileId, before, after: desired });
  return getStructuredPermissions(supabase, profileId);
}
