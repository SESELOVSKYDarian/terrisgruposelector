import "server-only";

import { createSign } from "node:crypto";

import type { DocsBodyContent } from "@/modules/s13/doc-table";
import { normalizePrivateKey, normalizeServiceAccountEmail } from "@/modules/s13/private-key";

const SCOPE = "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Service-account OAuth (JWT bearer). No Google SDK: one signed assertion, one POST. */
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!rawEmail || !key) throw new GoogleApiError("Faltan las credenciales de Google.", 500);
  const email = normalizeServiceAccountEmail(rawEmail);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  let signature: Buffer;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(normalizePrivateKey(key));
  } catch {
    throw new GoogleApiError("GOOGLE_PRIVATE_KEY no es una clave privada válida. Copiá el campo private_key del archivo JSON de la cuenta de servicio completo, desde -----BEGIN PRIVATE KEY----- hasta -----END PRIVATE KEY-----.", 500);
  }
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }) });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new GoogleApiError(`Google rechazó las credenciales: ${body.error_description ?? response.status}`, response.status);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" } });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!response.ok) throw new GoogleApiError(`Google: ${body.error?.message ?? response.status}`, response.status);
  return body;
}

export type GoogleDocument = { revisionId: string; body: DocsBodyContent };

export async function getDocument(documentId: string): Promise<GoogleDocument> {
  const data = await call<{ revisionId?: string; body?: { content?: DocsBodyContent } }>(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
  return { revisionId: data.revisionId ?? "", body: data.body?.content ?? [] };
}

/** One atomic batch. `requiredRevisionId` makes Google reject it if someone edited the Doc in between. */
export async function batchUpdate(documentId: string, requests: Record<string, unknown>[], revisionId: string) {
  if (!requests.length) return;
  await call(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests, writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined }) });
}

/**
 * Copies a Doc. When S13_DRIVE_FOLDER_ID is set the copy goes to that folder (share it with the service
 * account as editor); S13_SHARE_WITH_EMAILS (comma separated) gets editor access so people can open it
 * even though the service account owns the file.
 */
export async function copyDocument(sourceId: string, name: string) {
  const folder = process.env.S13_DRIVE_FOLDER_ID;
  const copy = await call<{ id: string }>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceId)}/copy?supportsAllDrives=true&fields=id`, { method: "POST", body: JSON.stringify({ name, ...(folder ? { parents: [folder] } : {}) }) });
  const emails = (process.env.S13_SHARE_WITH_EMAILS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const emailAddress of emails) {
    await call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copy.id)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, { method: "POST", body: JSON.stringify({ type: "user", role: "writer", emailAddress }) }).catch(() => undefined);
  }
  return copy.id;
}
