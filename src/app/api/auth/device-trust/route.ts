import { cookies } from "next/headers";
import { createTrustToken, getCurrentProfile, trustCookieName } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const cookieStore = await cookies();
  cookieStore.set(trustCookieName, createTrustToken(profile.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return ok();
}
