import "server-only";

import type { SessionProfile } from "@/lib/server/auth";
import { getPlanningAuthority } from "@/server/outings/planning";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";

export type TerritoryAccess = { canManage: boolean; canViewS13: boolean };

/**
 * Territory operations belong to Siervo de Territorios and Superintendente de Servicio;
 * the Coordinador additionally reads/generates the S-13. Planning authority already carries
 * the legacy ADMIN bridge, so today's administrator keeps working until responsibilities exist.
 */
export async function getTerritoryAccess(profile: SessionProfile): Promise<TerritoryAccess> {
  const planning = await getPlanningAuthority(profile);
  let canManage = planning.canPlan || planning.canPublish;
  let canViewS13 = canManage;
  try {
    const context = await getFreshPermissionContext(profile.id);
    if (context) {
      canManage = canManage || hasPermission(context, "MANAGE_TERRITORIES");
      canViewS13 = canViewS13 || canManage || hasPermission(context, "VIEW_S13");
    }
  } catch {
    // V2 permission tables pending: the planning bridge above already covers the legacy admin.
  }
  return { canManage, canViewS13 };
}
