import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";

/** Coordinador and Superintendente de Servicio publish announcements (legacy ADMIN maps to Coordinador). */
export async function canPublishAnnouncements(profile: SessionProfile) {
  try {
    const context = await getFreshPermissionContext(profile.id);
    return Boolean(context && hasPermission(context, "PUBLISH_ANNOUNCEMENTS"));
  } catch {
    // V2 permission tables pending: today's administrator keeps the ability.
    return profile.roles.includes("ADMIN");
  }
}
