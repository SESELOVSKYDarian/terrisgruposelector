import { fail, ok } from "@/lib/server/responses";
import { listDriveFolder, readDriveFileAsText } from "@/server/integrations/drive-scan";

export const runtime = "nodejs";

/**
 * One-off, read-only diagnostic: dumps every file of a Drive folder as plain text, for analyzing the
 * real (hand-kept) S-13 documents before deciding how to import their history. Secret-protected like
 * /api/cron/reminders — off by default (no S13_INSPECT_TOKEN, no route). Not a user-facing feature.
 * The only Drive write is a throwaway copy used to convert a non-Google file (.docx) to readable text;
 * it is deleted right after reading, and the original file is never touched.
 */
export async function GET(request: Request) {
  const secret = process.env.S13_INSPECT_TOKEN;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return fail("No autorizado.", 401);

  const folder = new URL(request.url).searchParams.get("folder");
  if (!folder) return fail("Falta el parámetro folder.", 422);

  try {
    const files = await listDriveFolder(folder);
    const results = [];
    for (const file of files) {
      const { text, note } = await readDriveFileAsText(file);
      results.push({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, chars: text.length, text, note });
    }
    return ok({ count: results.length, files: results });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "Error inesperado.", 500);
  }
}
