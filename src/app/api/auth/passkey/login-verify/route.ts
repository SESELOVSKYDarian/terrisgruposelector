import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { createAdminSupabaseClient, setSessionCookie, verifyWebauthnChallengeToken, webauthnChallengeCookieName, type SessionProfile } from "@/lib/server/auth";
import { getRpConfig } from "@/lib/server/webauthn";
import { fail, ok } from "@/lib/server/responses";
import type { Role } from "@/lib/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const challengePayload = verifyWebauthnChallengeToken(cookieStore.get(webauthnChallengeCookieName)?.value);
  if (!challengePayload) return fail("El desafio vencio, intenta de nuevo.", 401);

  const { rpID, origin } = getRpConfig(request);
  const response = (await request.json()) as AuthenticationResponseJSON;

  const supabase = createAdminSupabaseClient();
  const { data: stored } = await supabase
    .from("webauthn_credentials")
    .select("id, profile_id, credential_id, public_key, counter")
    .eq("credential_id", response.id)
    .maybeSingle();

  if (!stored) return fail("Llave de acceso no reconocida.", 401);

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengePayload.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(Buffer.from(stored.public_key, "base64url")),
      counter: stored.counter,
    },
  });

  if (!verification.verified) return fail("No se pudo verificar la llave de acceso.", 401);

  await supabase.from("webauthn_credentials").update({ counter: verification.authenticationInfo.newCounter }).eq("id", stored.id);

  const { data: existingProfile, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, group_id, active, must_change_password, profile_roles(role)")
    .eq("id", stored.profile_id)
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
  cookieStore.delete(webauthnChallengeCookieName);
  return ok({ profile });
}
