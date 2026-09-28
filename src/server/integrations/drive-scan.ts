import "server-only";

import { documentPlainText, isEffectivelyEmpty, type BodyElement } from "@/modules/s13/doc-text";
import { GoogleApiError, callGoogleApi, getRawDocument } from "./google-docs";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };

export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await callGoogleApi<{ files?: DriveFile[]; nextPageToken?: string }>(`https://www.googleapis.com/drive/v3/files?${params}`);
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files.filter((file) => file.mimeType !== GOOGLE_FOLDER_MIME);
}

async function deleteDriveFile(fileId: string) {
  await callGoogleApi(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" }).catch(() => undefined);
}

/**
 * Text of any Drive file this scan can make sense of. Native Google Docs are read directly; anything
 * else (an uploaded .docx, for instance) is converted through a throwaway copy — Drive's own
 * Word→Docs conversion, the same thing "Abrir con Documentos de Google" does — read, then deleted.
 * Never touches the original file.
 */
export async function readDriveFileAsText(file: DriveFile): Promise<{ text: string; note?: string }> {
  if (file.mimeType === GOOGLE_DOC_MIME) {
    const body = await getRawDocument(file.id);
    return { text: documentPlainText(body) };
  }
  let tempId: string | null = null;
  try {
    const copy = await callGoogleApi<{ id: string }>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/copy?supportsAllDrives=true&fields=id`, {
      method: "POST",
      body: JSON.stringify({ name: `[lectura temporal] ${file.name}`, mimeType: GOOGLE_DOC_MIME }),
    });
    tempId = copy.id;
    const body = await getRawDocument(copy.id);
    const text = documentPlainText(body);
    if (isEffectivelyEmpty(text)) return { text: "", note: `No se pudo convertir "${file.name}" (${file.mimeType}) a texto legible.` };
    return { text };
  } catch (cause) {
    const message = cause instanceof GoogleApiError ? cause.message : cause instanceof Error ? cause.message : "error desconocido";
    return { text: "", note: `No se pudo leer "${file.name}": ${message}` };
  } finally {
    if (tempId) await deleteDriveFile(tempId);
  }
}

export type { BodyElement };
