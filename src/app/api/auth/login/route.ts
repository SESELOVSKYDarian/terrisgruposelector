import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createAdminSupabaseClient,
  createOtpPendingToken,
  generateOtpCode,
  hashPassword,
  otpPendingCookieName,
  setSessionCookie,
  trustCookieName,
  verifyPassword,
  verifyTrustToken,
  type SessionProfile,
} from "@/lib/server/auth";
import { otpEmailHtml, sendMail } from "@/lib/server/mail";
import { fail } from "@/lib/server/responses";
import type { Role } from "@/lib/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { username, password, deviceSecure } = (await request.json()) as {
    username?: string;
    password?: string;
    deviceSecure?: boolean;
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
    .select("id, username, full_name, group_id, active, must_change_password, password_hash, email, approval_status, profile_roles(role)")
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
      .select("id, username, full_name, group_id, active, must_change_password")
      .single();

    if (upsertError || !adminProfile) {
      return fail(upsertError?.message ?? "No se pudo crear el super admin.", 500);
    }

    await supabase.from("profile_roles").upsert({ profile_id: adminProfile.id, role: "ADMIN" }, { onConflict: "profile_id,role" });
    const profile: SessionProfile = { ...adminProfile, roles: ["ADMIN"] };
    await setSessionCookie(profile);
    return NextResponse.json({ status: "ok", profile });
  }

  if (!existingProfile || !existingProfile.active) {
    return fail("Usuario o contrasena incorrectos.", 401);
  }

  if (!verifyPassword(password, existingProfile.password_hash ?? "")) {
    return fail("Usuario o contrasena incorrectos.", 401);
  }

  if (existingProfile.approval_status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  const profile: SessionProfile = {
    id: existingProfile.id,
    username: existingProfile.username,
    full_name: existingProfile.full_name,
    group_id: existingProfile.group_id,
    roles: (existingProfile.profile_roles ?? []).map((entry: { role: Role }) => entry.role),
    active: existingProfile.active,
    must_change_password: existingProfile.must_change_password,
  };

  const cookieStore = await cookies();
  const trustValid = verifyTrustToken(cookieStore.get(trustCookieName)?.value, profile.id);

  if (trustValid || deviceSecure || !existingProfile.email) {
    await setSessionCookie(profile);
    return NextResponse.json({ status: "ok", profile, offerPasskey: Boolean(deviceSecure) && !trustValid });
  }

  const code = generateOtpCode();
  await sendMail(existingProfile.email, "Tu codigo de verificacion", otpEmailHtml(code));
  const pendingToken = createOtpPendingToken(profile.id, code);
  cookieStore.set(otpPendingCookieName, pendingToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  });

  return NextResponse.json({ status: "otp" });
}
