import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient, getCurrentProfile, hasPasskeyCookieName, verifyWebauthnChallengeToken, webauthnChallengeCookieName } from "@/lib/server/auth";
import { getRpConfig } from "@/lib/server/webauthn";
import { fail, ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return fail("No autenticado.", 401);

  const cookieStore = await cookies();
  const challengePayload = verifyWebauthnChallengeToken(cookieStore.get(webauthnChallengeCookieName)?.value);
  if (!challengePayload || challengePayload.profileId !== profile.id) {
    return fail("El desafio vencio, intenta de nuevo.", 401);
  }

  const { rpID, origin } = getRpConfig(request);
  const response = (await request.json()) as RegistrationResponseJSON;

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengePayload.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return fail("No se pudo verificar la llave de acceso.", 400);
  }

  const { credential } = verification.registrationInfo;
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("webauthn_credentials").insert({
    profile_id: profile.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
  });

  if (error) return fail(error.message, 500);

  cookieStore.delete(webauthnChallengeCookieName);
  cookieStore.set(hasPasskeyCookieName, "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return ok();
}
