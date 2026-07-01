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
  role: Role;
  active: boolean;
  must_change_password: boolean;
};

type SessionPayload = {
  profileId: string;
  username: string;
  role: Role;
  exp: number;
};

const sessionCookieName = "terris_session";
const sessionMaxAgeSeconds = 60 * 60 * 8;

export function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
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
  const secret = process.env.SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error("Falta SESSION_SECRET o SUPABASE_SERVICE_ROLE_KEY.");
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
    role: profile.role,
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
    .select("id, username, full_name, group_id, role, active, must_change_password")
    .eq("id", payload.profileId)
    .single();

  if (error || !data || !data.active) {
    return null;
  }

  return data as SessionProfile;
}

export function assertAdmin(profile: SessionProfile) {
  if (profile.role !== "ADMIN") {
    throw new Error("No autorizado.");
  }
}

export function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}
