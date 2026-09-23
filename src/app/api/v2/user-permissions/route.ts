import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/server/auth";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";
import { getFreshPermissionContext, hasPermission, invalidatePermissionContext } from "@/server/permissions";
import { getStructuredPermissions, setStructuredPermissions } from "@/server/users/permissions";

export const runtime = "nodejs";

async function requireManageUsers(profileId: string) {
  const context = await getFreshPermissionContext(profileId);
  if (!context || !hasPermission(context, "MANAGE_USERS")) forbid("No tenés permiso para editar permisos de usuarios.");
}

export async function GET(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    await requireManageUsers(profile.id);
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!profileId) throw new ApiError("Falta el usuario.", 422);
    const supabase = createAdminSupabaseClient();
    return { permissions: await getStructuredPermissions(supabase, profileId) };
  });
}

const body = z.object({ profileId: z.string().uuid(), permissions: z.unknown() });

export async function POST(request: Request) {
  return handle(async () => {
    const profile = await requireProfile();
    await requireManageUsers(profile.id);
    const { profileId, permissions } = await parseBody(request, body);
    const supabase = createAdminSupabaseClient();
    try {
      return { permissions: await setStructuredPermissions(supabase, profile.id, profileId, permissions) };
    } finally {
      invalidatePermissionContext(profileId);
    }
  });
}
