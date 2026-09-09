import { createAdminSupabaseClient, hashPassword, verifyResetToken } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { token, password } = (await request.json()) as { token?: string; password?: string };

  if (!token || !password || password.length < 8) {
    return fail("Falta el token o la contrasena es muy corta.", 422);
  }

  const profileId = verifyResetToken(token);
  if (!profileId) {
    return fail("El link vencio o no es valido.", 401);
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ password_hash: hashPassword(password), must_change_password: false, password_updated_at: new Date().toISOString() })
    .eq("id", profileId);

  if (error) return fail(error.message, 500);
  return ok();
}
