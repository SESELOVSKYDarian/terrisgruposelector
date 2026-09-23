import { createAdminSupabaseClient } from "@/lib/server/auth";
import { forbid, handle, requireProfile } from "@/server/api";
import { getLockDuration } from "@/server/buildings/activity";
import { googleCredentialsConfigured, s13WritesEnabled } from "@/server/integrations/s13-target";
import { smtpConfigured } from "@/lib/server/mail";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";
import { getPublicVapidKey } from "@/server/push";
import { getTerritoryAccess } from "@/server/territories/access";

export const runtime = "nodejs";

/**
 * System settings overview. Reading is for the Coordinador (system) and for Servicio/Territorios;
 * it exposes only whether each integration is configured, never a secret value.
 */
export async function GET() {
  return handle(async () => {
    const profile = await requireProfile();
    const territories = await getTerritoryAccess(profile);
    let canSystem = profile.roles.includes("ADMIN");
    try {
      const context = await getFreshPermissionContext(profile.id);
      canSystem = Boolean(context && hasPermission(context, "MANAGE_SYSTEM"));
    } catch {
      // V2 permission tables pending: legacy ADMIN keeps access.
    }
    if (!canSystem && !territories.canManage) forbid("No tenés acceso a los ajustes del sistema.");
    return {
      canEditLock: territories.canManage,
      lock: await getLockDuration(createAdminSupabaseClient()).catch(() => null),
      integrations: {
        push: Boolean(getPublicVapidKey()),
        googleCredentials: googleCredentialsConfigured(),
        googleWrites: s13WritesEnabled(),
        cron: Boolean(process.env.CRON_SECRET),
        email: smtpConfigured() || Boolean(process.env.RESEND_API_KEY),
      },
    };
  });
}
