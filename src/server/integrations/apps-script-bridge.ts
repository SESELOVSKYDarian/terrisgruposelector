import "server-only";

/**
 * Creates a Doc copy through a Google Apps Script deployed under a real Google account instead of
 * the service account (which has zero Drive storage quota and can never create files on its own).
 * Returns null when the bridge isn't configured, so callers fall back to the direct API copy.
 */
export async function copyDocumentViaAppsScript(sourceId: string, name: string, folderId: string | undefined): Promise<string | null> {
  const url = process.env.S13_APPS_SCRIPT_URL;
  const secret = process.env.S13_APPS_SCRIPT_SECRET;
  if (!url || !secret) return null;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret, sourceId, name, folderId, shareWithEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL }) });
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok || !body.id) throw new Error(`El script de Google no pudo crear la copia de "${name}": ${body.error ?? response.status}`);
  return body.id;
}
