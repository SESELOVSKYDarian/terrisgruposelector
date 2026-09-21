import { getCurrentProfile } from "@/lib/server/auth";
import { getFreshPermissionContext, navigationAccess } from "@/server/permissions";
import { fail, ok } from "@/lib/server/responses";
import { getPlanningAuthority } from "@/server/outings/planning";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const permissions = await getFreshPermissionContext(profile.id);
  if (!permissions) return fail("No autorizado.", 403);

  // Planning visibility follows the same authority the mutation endpoints enforce (incl. the legacy ADMIN bridge).
  const planning = await getPlanningAuthority(profile);
  return ok({ access: { ...navigationAccess(permissions), canPlanOutings: planning.canPlan || planning.canPublish } });
}
