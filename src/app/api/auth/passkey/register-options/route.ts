import { generateRegistrationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient, createWebauthnChallengeToken, getCurrentProfile, webauthnChallengeCookieName } from "@/lib/server/auth";
import { getRpConfig } from "@/lib/server/webauthn";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const { rpID, rpName } = getRpConfig(request);
  const supabase = createAdminSupabaseClient();
  const { data: existing } = await supabase.from("webauthn_credentials").select("credential_id").eq("profile_id", profile.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: profile.username,
    userDisplayName: profile.full_name,
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((credential) => ({ id: credential.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const cookieStore = await cookies();
  cookieStore.set(webauthnChallengeCookieName, createWebauthnChallengeToken(options.challenge, profile.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
    path: "/",
  });

  return ok(options);
}
