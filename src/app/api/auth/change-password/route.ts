import { createAdminSupabaseClient, getCurrentProfile, hashPassword } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { isPasswordValid } from "@/lib/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const { newPassword } = (await request.json()) as { newPassword?: string };
  if (!newPassword || !isPasswordValid(newPassword)) {
    return fail("La contrasena tiene que tener 8 caracteres, mayuscula, minuscula, numero y caracter especial.", 422);
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ password_hash: hashPassword(newPassword), must_change_password: false, password_updated_at: new Date().toISOString() })
    .eq("id", profile.id);

  if (error) return fail(error.message, 500);
  return ok();
}
