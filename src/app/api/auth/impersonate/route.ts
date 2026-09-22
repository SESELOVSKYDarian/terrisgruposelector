import { z } from "zod";
import {
  clearSessionCookie,
  createAdminSupabaseClient,
  getImpersonationActorId,
  setSessionCookie,
  type SessionProfile,
} from "@/lib/server/auth";
import { getFreshPermissionContext, hasPermission } from "@/server/permissions";
import { writeAudit } from "@/server/outings/planning";
import { ApiError, forbid, handle, parseBody, requireProfile } from "@/server/api";

export const runtime = "nodejs";

const PROFILE_COLUMNS = "id, username, full_name, group_id, active, must_change_password, profile_roles(role)";

async function loadSessionProfile(supabase: ReturnType<typeof createAdminSupabaseClient>, id: string): Promise<SessionProfile> {
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.active) throw new ApiError("Esa cuenta ya no está activa.", 404);
  const { profile_roles, ...rest } = data;
  return { ...rest, roles: (profile_roles ?? []).map((entry: { role: string }) => entry.role) } as SessionProfile;
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), payload: z.object({ profileId: z.string().uuid() }) }),
  z.object({ action: z.literal("end"), payload: z.object({}).optional() }),
]);

/**
 * Lets an admin (MANAGE_USERS) open the app as another profile without ever touching that
 * profile's password — for support and QA. The admin's own id rides along in the session
 * (actorId) so "volver a mi cuenta" needs no credentials either, and every start/end is audited.
 * Impersonation sessions cannot be chained: you must return to your own account first.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const current = await requireProfile();
    const { action, payload } = await parseBody(request, body);
    const supabase = createAdminSupabaseClient();

    if (action === "start") {
      const alreadyImpersonating = await getImpersonationActorId();
      if (alreadyImpersonating) forbid("Ya estás viendo la cuenta de otra persona. Volvé a la tuya antes de entrar a otra.");

      const permissions = await getFreshPermissionContext(current.id);
      if (!permissions || !hasPermission(permissions, "MANAGE_USERS")) forbid("No tenés permiso para entrar como otro usuario.");
      if (payload.profileId === current.id) forbid("Ya sos vos.");

      const target = await loadSessionProfile(supabase, payload.profileId);
      const hadPendingPasswordChange = target.must_change_password;
      if (hadPendingPasswordChange) {
        // The temporary-password screen would otherwise block the admin (who never has that
        // password) instead of the person it protects. Clearing it here is data, not a credential.
        const { error: clearError } = await supabase.from("profiles").update({ must_change_password: false }).eq("id", target.id);
        if (clearError) throw new Error(clearError.message);
        target.must_change_password = false;
      }
      await setSessionCookie(target, current.id);
      await writeAudit(supabase, { actorId: current.id, action: "USER_IMPERSONATE_START", entityType: "profile", entityId: target.id, metadata: { target_username: target.username, cleared_must_change_password: hadPendingPasswordChange } });
      return { profile: target, actor: { id: current.id, full_name: current.full_name } };
    }

    const actorId = await getImpersonationActorId();
    if (!actorId) throw new ApiError("No estás viendo la cuenta de otra persona.", 409);
    const actor = await loadSessionProfile(supabase, actorId);
    await setSessionCookie(actor);
    await writeAudit(supabase, { actorId: actor.id, action: "USER_IMPERSONATE_END", entityType: "profile", entityId: current.id, metadata: { target_username: current.username } });
    return { profile: actor };
  });
}

export async function GET() {
  return handle(async () => {
    const actorId = await getImpersonationActorId();
    if (!actorId) return { impersonating: null };
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.from("profiles").select("id, full_name, username").eq("id", actorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      // The actor's own account disappeared mid-impersonation; drop the session rather than get stuck.
      await clearSessionCookie();
      return { impersonating: null };
    }
    return { impersonating: { id: data.id, full_name: data.full_name, username: data.username } };
  });
}
