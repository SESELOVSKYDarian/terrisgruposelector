import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient, createOtpPendingToken, generateOtpCode, otpPendingCookieName, readOtpPendingProfileId } from "@/lib/server/auth";
import { otpEmailHtml, sendMail } from "@/lib/server/mail";
import { fail } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const profileId = readOtpPendingProfileId(cookieStore.get(otpPendingCookieName)?.value);
  if (!profileId) return fail("No hay una verificacion pendiente.", 400);

  const supabase = createAdminSupabaseClient();
  const { data: profile, error } = await supabase.from("profiles").select("email").eq("id", profileId).maybeSingle();
  if (error || !profile?.email) return fail("No se pudo reenviar el codigo.", 400);

  const code = generateOtpCode();
  await sendMail(profile.email, "Tu codigo de verificacion", otpEmailHtml(code));
  const pendingToken = createOtpPendingToken(profileId, code);
  cookieStore.set(otpPendingCookieName, pendingToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  });

  return NextResponse.json({ status: "ok" });
}
