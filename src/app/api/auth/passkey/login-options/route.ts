import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { createWebauthnChallengeToken, webauthnChallengeCookieName } from "@/lib/server/auth";
import { getRpConfig } from "@/lib/server/webauthn";
import { ok } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { rpID } = getRpConfig(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });

  const cookieStore = await cookies();
  cookieStore.set(webauthnChallengeCookieName, createWebauthnChallengeToken(options.challenge), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
    path: "/",
  });

  return ok(options);
}
