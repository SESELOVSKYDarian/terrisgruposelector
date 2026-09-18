import { getCurrentProfile } from "@/lib/server/auth";
import { getFreshPermissionContext, navigationAccess } from "@/server/permissions";
import { fail, ok } from "@/lib/server/responses";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const permissions = await getFreshPermissionContext(profile.id);
  if (!permissions) return fail("No autorizado.", 403);

  return ok({ access: navigationAccess(permissions) });
}
