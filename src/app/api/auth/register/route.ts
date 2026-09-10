import { createAdminSupabaseClient, hashPassword } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";
import { deriveFullNameFromUsername, isEmailValid, isPasswordValid } from "@/lib/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { username, email, password } = (await request.json()) as {
    username?: string;
    email?: string;
    password?: string;
  };

  const cleanUsername = username?.trim() ?? "";
  const cleanEmail = email?.trim().toLowerCase() ?? "";

  if (!cleanUsername || !cleanEmail || !password) {
    return fail("Completa todos los campos.", 422);
  }
  if (!isEmailValid(cleanEmail)) {
    return fail("El mail no es valido.", 422);
  }
  if (!isPasswordValid(password)) {
    return fail("La contrasena tiene que tener 8 caracteres, mayuscula, minuscula, numero y caracter especial.", 422);
  }

  const supabase = createAdminSupabaseClient();

  const { data: existingUsername } = await supabase.from("profiles").select("id").eq("username", cleanUsername).maybeSingle();
  if (existingUsername) return fail("Ese usuario ya existe.", 409);

  const { data: existingEmail } = await supabase.from("profiles").select("id").eq("email", cleanEmail).maybeSingle();
  if (existingEmail) return fail("Ese mail ya esta registrado.", 409);

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      username: cleanUsername,
      full_name: deriveFullNameFromUsername(cleanUsername),
      email: cleanEmail,
      role: "PUBLICADOR",
      approval_status: "pending",
      active: true,
      must_change_password: false,
      password_hash: hashPassword(password),
      password_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) {
    return fail(error?.message ?? "No se pudo crear la cuenta.", 500);
  }

  const { error: roleError } = await supabase.from("profile_roles").insert({ profile_id: created.id, role: "PUBLICADOR" });
  if (roleError) return fail(roleError.message, 500);

  return ok({ status: "pending" });
}
