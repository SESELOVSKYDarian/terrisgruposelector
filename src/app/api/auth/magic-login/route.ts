import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient, otpPendingCookieName, readOtpPendingTrust, setSessionCookie, setTrustCookie, verifyMagicLoginToken, type SessionProfile } from "@/lib/server/auth";
import { fail } from "@/lib/server/responses";
import type { Role } from "@/lib/domain";

export const runtime = "nodejs";

/** Completes login from the "Iniciar sesión" link in the OTP email. Same result as typing the code. */
export async function POST(request: Request) {
  const { token } = (await request.json()) as { token?: string };
  if (!token) return fail("Falta el link.", 422);

  const profileId = verifyMagicLoginToken(token);
  if (!profileId) return fail("El link venció o ya se usó. Pedí uno nuevo desde la pantalla de ingreso.", 401);

  const supabase = createAdminSupabaseClient();
  const { data: existingProfile, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, group_id, active, must_change_password, profile_roles(role)")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !existingProfile || !existingProfile.active) return fail("No se pudo completar el ingreso.", 401);

  const profile: SessionProfile = {
    id: existingProfile.id,
    username: existingProfile.username,
    full_name: existingProfile.full_name,
    group_id: existingProfile.group_id,
    roles: (existingProfile.profile_roles ?? []).map((entry: { role: Role }) => entry.role),
    active: existingProfile.active,
    must_change_password: existingProfile.must_change_password,
  };

  // Same browser that asked for the code with "Este dispositivo es seguro" ticked: remember it.
  const cookieStore = await cookies();
  const trust = readOtpPendingTrust(cookieStore.get(otpPendingCookieName)?.value);
  if (trust) await setTrustCookie(profile.id);
  await setSessionCookie(profile, undefined, { remember: trust });
  cookieStore.delete(otpPendingCookieName);
  return NextResponse.json({ status: "ok", profile });
}
