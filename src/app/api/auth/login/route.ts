import { NextResponse } from "next/server";
import {
  createAdminSupabaseClient,
  hashPassword,
  setSessionCookie,
  verifyPassword,
  type SessionProfile,
} from "@/lib/server/auth";
import { fail } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { username, password } = (await request.json()) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return fail("Usuario y contrasena son obligatorios.", 422);
  }

  const supabase = createAdminSupabaseClient();
  const cleanUsername = username.trim();
  const superAdminUsername = process.env.SUPER_ADMIN_USERNAME ?? "DaSeselovsky";
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

  const { data: existingProfile, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, group_id, role, active, must_change_password, password_hash")
    .eq("username", cleanUsername)
    .maybeSingle();

  if (error) {
    return fail(error.message, 500);
  }

  if (
    cleanUsername === superAdminUsername &&
    superAdminPassword &&
    password === superAdminPassword &&
    (!existingProfile || !verifyPassword(password, existingProfile.password_hash ?? ""))
  ) {
    const passwordHash = hashPassword(password);
    const { data: adminProfile, error: upsertError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: existingProfile?.id,
          username: superAdminUsername,
          full_name: "Da Seselovsky",
          role: "ADMIN",
          active: true,
          password_hash: passwordHash,
          must_change_password: false,
          password_updated_at: new Date().toISOString(),
        },
        { onConflict: "username" },
      )
      .select("id, username, full_name, group_id, role, active, must_change_password")
      .single();

    if (upsertError || !adminProfile) {
      return fail(upsertError?.message ?? "No se pudo crear el super admin.", 500);
    }

    await setSessionCookie(adminProfile as SessionProfile);
    return NextResponse.json({ profile: adminProfile });
  }

  if (!existingProfile || !existingProfile.active) {
    return fail("Usuario o contrasena incorrectos.", 401);
  }

  if (!verifyPassword(password, existingProfile.password_hash ?? "")) {
    return fail("Usuario o contrasena incorrectos.", 401);
  }

  const profile: SessionProfile = {
    id: existingProfile.id,
    username: existingProfile.username,
    full_name: existingProfile.full_name,
    group_id: existingProfile.group_id,
    role: existingProfile.role,
    active: existingProfile.active,
    must_change_password: existingProfile.must_change_password,
  };

  await setSessionCookie(profile);
  return NextResponse.json({ profile });
}
