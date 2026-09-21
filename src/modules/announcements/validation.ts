export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_DESCRIPTION_MAX = 1500;

export type AnnouncementInput = { title: string; description: string };

/** Trims and collapses line noise; both fields are required. */
export function validateAnnouncement(input: { title?: unknown; description?: unknown }): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  const description = typeof input.description === "string" ? input.description.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return { ok: false, error: "El título es obligatorio." };
  if (!description) return { ok: false, error: "La descripción es obligatoria." };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return { ok: false, error: `El título admite hasta ${ANNOUNCEMENT_TITLE_MAX} caracteres.` };
  if (description.length > ANNOUNCEMENT_DESCRIPTION_MAX) return { ok: false, error: `La descripción admite hasta ${ANNOUNCEMENT_DESCRIPTION_MAX} caracteres.` };
  return { ok: true, value: { title, description } };
}

/** Splits recipients so a fan-out never fires hundreds of deliveries at once. */
export function chunk<T>(items: T[], size: number) {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
}
