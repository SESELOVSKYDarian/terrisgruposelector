import "server-only";

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/domain";

export type SessionProfile = {
  id: string;
  username: string;
  full_name: string;
  group_id: string | null;
  roles: Role[];
  active: boolean;
  must_change_password: boolean;
};

type SessionPayload = {
  profileId: string;
  username: string;
  roles: Role[];
  exp: number;
};

const sessionCookieName = "terris_session";
const sessionMaxAgeSeconds = 60 * 60 * 8;

export function createAdminSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, key] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !key) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(key, "base64url");

  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    throw new Error("Falta SESSION_SECRET o SUPABASE_JWT_SECRET.");
  }

  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function encodeSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decodeSession(token?: string): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");

  if (!body || !signature || sign(body) !== signature) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;

  if (!payload.exp || payload.exp < Date.now()) {
    return null;
  }

  return payload;
}

export async function setSessionCookie(profile: SessionProfile) {
  const cookieStore = await cookies();
  const token = encodeSession({
    profileId: profile.id,
    username: profile.username,
    roles: profile.roles,
    exp: Date.now() + sessionMaxAgeSeconds * 1000,
  });

  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export async function getCurrentProfile() {
  const cookieStore = await cookies();
  const payload = decodeSession(cookieStore.get(sessionCookieName)?.value);

  if (!payload) {
    return null;
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, group_id, active, must_change_password, profile_roles(role)")
    .eq("id", payload.profileId)
    .single();

  if (error || !data || !data.active) {
    return null;
  }

  const { profile_roles, ...rest } = data;
  const roles = (profile_roles ?? []).map((entry: { role: Role }) => entry.role);

  return { ...rest, roles } as SessionProfile;
}

export function assertAdmin(profile: SessionProfile) {
  if (!profile.roles.includes("ADMIN")) {
    throw new Error("No autorizado.");
  }
}

export function isConductor(profile: SessionProfile) {
  return profile.roles.includes("CONDUCTOR");
}

export function isAnciano(profile: SessionProfile) {
  return profile.roles.includes("ANCIANO");
}

export function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

function signGenericPayload<T extends object>(payload: T, ttlMs: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyGenericPayload<T>(token?: string): (T & { exp: number }) | null {
  if (!token) return null;
  const [body, signature] = token.split(".");

  if (!body || !signature || sign(body) !== signature) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };

  if (!payload.exp || payload.exp < Date.now()) {
    return null;
  }

  return payload;
}

export const otpPendingCookieName = "terris_otp_pending";
export const trustCookieName = "terris_trust";
export const webauthnChallengeCookieName = "terris_webauthn_challenge";
export const hasPasskeyCookieName = "terris_has_passkey";

const otpTtlMs = 10 * 60 * 1000;
const trustTtlMs = 7 * 24 * 60 * 60 * 1000;
const webauthnChallengeTtlMs = 5 * 60 * 1000;

export function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtpCode(code: string) {
  return createHmac("sha256", getSessionSecret()).update(code).digest("base64url");
}

type OtpPendingPayload = { profileId: string; codeHash: string; attempts: number };

export function createOtpPendingToken(profileId: string, code: string) {
  return signGenericPayload<OtpPendingPayload>({ profileId, codeHash: hashOtpCode(code), attempts: 0 }, otpTtlMs);
}

export function reissueOtpPendingToken(token: string) {
  const payload = verifyGenericPayload<OtpPendingPayload>(token);
  if (!payload) return null;
  return signGenericPayload<OtpPendingPayload>({ profileId: payload.profileId, codeHash: payload.codeHash, attempts: payload.attempts + 1 }, otpTtlMs);
}

export function readOtpPendingProfileId(token?: string) {
  return verifyGenericPayload<OtpPendingPayload>(token)?.profileId ?? null;
}

export function verifyOtpCode(token: string | undefined, code: string) {
  const payload = verifyGenericPayload<OtpPendingPayload>(token);
  if (!payload) return { ok: false as const, reason: "expired" as const };
  if (payload.attempts >= 5) return { ok: false as const, reason: "too_many_attempts" as const };

  const candidateHash = hashOtpCode(code);
  const matches = candidateHash.length === payload.codeHash.length && timingSafeEqual(Buffer.from(candidateHash), Buffer.from(payload.codeHash));

  if (!matches) return { ok: false as const, reason: "mismatch" as const };
  return { ok: true as const, profileId: payload.profileId };
}

type TrustPayload = { profileId: string };

export function createTrustToken(profileId: string) {
  return signGenericPayload<TrustPayload>({ profileId }, trustTtlMs);
}

export function verifyTrustToken(token: string | undefined, profileId: string) {
  const payload = verifyGenericPayload<TrustPayload>(token);
  return payload?.profileId === profileId;
}

type ResetPayload = { profileId: string };

export function createResetToken(profileId: string) {
  return signGenericPayload<ResetPayload>({ profileId }, 30 * 60 * 1000);
}

export function verifyResetToken(token: string) {
  return verifyGenericPayload<ResetPayload>(token)?.profileId ?? null;
}

type WebauthnChallengePayload = { challenge: string; profileId?: string };

export function createWebauthnChallengeToken(challenge: string, profileId?: string) {
  return signGenericPayload<WebauthnChallengePayload>({ challenge, profileId }, webauthnChallengeTtlMs);
}

export function verifyWebauthnChallengeToken(token: string | undefined) {
  return verifyGenericPayload<WebauthnChallengePayload>(token);
}
