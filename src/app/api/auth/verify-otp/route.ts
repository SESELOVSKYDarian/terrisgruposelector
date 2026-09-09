import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createAdminSupabaseClient,
  otpPendingCookieName,
  readOtpPendingProfileId,
  reissueOtpPendingToken,
  setSessionCookie,
  verifyOtpCode,
  type SessionProfile,
} from "@/lib/server/auth";
import { fail } from "@/lib/server/responses";
import type { Role } from "@/lib/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { code } = (await request.json()) as { code?: string };
  if (!code) return fail("Falta el codigo.", 422);

  const cookieStore = await cookies();
  const pendingToken = cookieStore.get(otpPendingCookieName)?.value;
  const result = verifyOtpCode(pendingToken, code.trim());

  if (!result.ok) {
    if (result.reason === "mismatch" && pendingToken) {
      const reissued = reissueOtpPendingToken(pendingToken);
      if (reissued) {
        cookieStore.set(otpPendingCookieName, reissued, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 10 * 60,
          path: "/",
        });
      }
    }
    const message =
      result.reason === "too_many_attempts"
        ? "Demasiados intentos. Pedi un codigo nuevo."
        : result.reason === "expired"
          ? "El codigo vencio. Pedi uno nuevo."
          : "Codigo incorrecto.";
    return fail(message, 401);
  }

  const supabase = createAdminSupabaseClient();
  const { data: existingProfile, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, group_id, active, must_change_password, profile_roles(role)")
    .eq("id", result.profileId)
    .maybeSingle();

  if (error || !existingProfile || !existingProfile.active) {
    return fail("No se pudo completar el ingreso.", 401);
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

  await setSessionCookie(profile);
  cookieStore.delete(otpPendingCookieName);
  return NextResponse.json({ status: "ok", profile });
}

export async function GET() {
  const cookieStore = await cookies();
  const profileId = readOtpPendingProfileId(cookieStore.get(otpPendingCookieName)?.value);
  if (!profileId) return fail("No hay una verificacion pendiente.", 400);
  return NextResponse.json({ status: "pending" });
}
