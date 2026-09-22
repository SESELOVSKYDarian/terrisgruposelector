import { createAdminSupabaseClient, getCurrentProfile, getImpersonationActorId } from "@/lib/server/auth";
import { getFreshPermissionContext, navigationAccess } from "@/server/permissions";
import { fail, ok } from "@/lib/server/responses";
import { getPlanningAuthority } from "@/server/outings/planning";
import { getTerritoryAccess } from "@/server/territories/access";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const permissions = await getFreshPermissionContext(profile.id);
  if (!permissions) return fail("No autorizado.", 403);

  const supabase = createAdminSupabaseClient();
  // Planning visibility follows the same authority the mutation endpoints enforce (incl. the legacy ADMIN bridge).
  const [planning, territories, actorId] = await Promise.all([getPlanningAuthority(profile), getTerritoryAccess(profile), getImpersonationActorId()]);
  // "Mi territorio" appears only for people with an active personal assignment (pre-migration: hidden).
  const personal = await supabase.from("personal_territory_assignments").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "ACTIVE");
  const impersonating = actorId ? (await supabase.from("profiles").select("id, full_name").eq("id", actorId).maybeSingle()).data : null;
  return ok({
    access: { ...navigationAccess(permissions), canPlanOutings: planning.canPlan || planning.canPublish, canManageTerritories: territories.canManage, canViewS13: territories.canViewS13, hasPersonalTerritory: !personal.error && (personal.count ?? 0) > 0 },
    impersonating,
  });
}
