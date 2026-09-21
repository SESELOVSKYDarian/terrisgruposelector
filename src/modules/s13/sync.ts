import { S13_SLOTS_PER_PAGE, formatS13Date, type S13Page } from "./layout";

/**
 * Logical S-13 cells. A key is stable and independent of Google Docs:
 *   "p<page>/t<territory>/last"            "Última fecha en que se completó"
 *   "p<page>/t<territory>/s<slot>/who"     "Asignado a" (top row, conductor)
 *   "p<page>/t<territory>/s<slot>/from"    fecha asignada (bottom row)
 *   "p<page>/t<territory>/s<slot>/to"      fecha en que se completó (bottom row)
 */
export type CellMap = Record<string, string>;

export function cellKey(page: number, territory: number, part: "last" | { slot: number; field: "who" | "from" | "to" }) {
  return part === "last" ? `p${page}/t${territory}/last` : `p${page}/t${territory}/s${part.slot}/${part.field}`;
}

/** The whole document as logical cells: empty cells are omitted, so clearing = absence. */
export function pagesToCells(pages: S13Page[]): CellMap {
  const cells: CellMap = {};
  for (const page of pages) {
    for (const row of page.rows) {
      const last = formatS13Date(row.last_completed_on);
      if (last) cells[cellKey(page.page, row.territory_number, "last")] = last;
      row.slots.forEach((slot, index) => {
        if (!slot) return;
        if (slot.conductor) cells[cellKey(page.page, row.territory_number, { slot: index, field: "who" })] = slot.conductor;
        const from = formatS13Date(slot.assigned_on);
        if (from) cells[cellKey(page.page, row.territory_number, { slot: index, field: "from" })] = from;
        const to = formatS13Date(slot.completed_on);
        if (to) cells[cellKey(page.page, row.territory_number, { slot: index, field: "to" })] = to;
      });
    }
  }
  return cells;
}

export type CellChange = { key: string; operation: "SET" | "CLEAR"; value: string | null };

/** Only the differences between what the Doc last received and what the database says now. */
export function diffCells(desired: CellMap, snapshot: CellMap): { changes: CellChange[]; unchanged: number } {
  const changes: CellChange[] = [];
  let unchanged = 0;
  for (const [key, value] of Object.entries(desired)) {
    if (snapshot[key] === value) unchanged += 1;
    else changes.push({ key, operation: "SET", value });
  }
  for (const key of Object.keys(snapshot)) {
    if (!(key in desired)) changes.push({ key, operation: "CLEAR", value: null });
  }
  return { changes: changes.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })), unchanged };
}

const KEY_PATTERN = /^p(\d+)\/t(\d+)\/(?:(last)|s(\d)\/(who|from|to))$/;

export function parseCellKey(key: string) {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  return { page: Number(match[1]), territory: Number(match[2]), slot: match[3] ? null : Number(match[4]), field: (match[3] ? "last" : match[5]) as "last" | "who" | "from" | "to" };
}

/**
 * Where a logical cell lives inside the document's table for a page. Two rows per territory:
 * top = conductor names, bottom = assigned/completed dates. The offsets describe the standard
 * S-13 layout and MUST be confirmed against the staging copy before any real write.
 */
export type S13Layout = { headerRows: number; firstColumnsBeforeSlots: number; slotsPerPage: number };
export const DEFAULT_S13_LAYOUT: S13Layout = { headerRows: 2, firstColumnsBeforeSlots: 2, slotsPerPage: S13_SLOTS_PER_PAGE };

export function cellCoordinates(key: string, firstTerritory: number, layout: S13Layout = DEFAULT_S13_LAYOUT): { page: number; row: number; column: number } | null {
  const parsed = parseCellKey(key);
  if (!parsed || parsed.territory < firstTerritory) return null;
  const topRow = layout.headerRows + (parsed.territory - firstTerritory) * 2;
  if (parsed.field === "last") return { page: parsed.page, row: topRow, column: 1 };
  if (parsed.slot === null || parsed.slot >= layout.slotsPerPage) return null;
  // Top row: one merged "Asignado a" cell per slot. Bottom row: assigned + completed date per slot.
  if (parsed.field === "who") return { page: parsed.page, row: topRow, column: layout.firstColumnsBeforeSlots + parsed.slot };
  return { page: parsed.page, row: topRow + 1, column: parsed.slot * 2 + (parsed.field === "to" ? 1 : 0) };
}

/** Changes grouped by the S-13 page (hoja) they belong to; each page is its own Google Doc. */
export function groupChangesByPage(changes: CellChange[]) {
  const byPage = new Map<number, CellChange[]>();
  for (const change of changes) {
    const parsed = parseCellKey(change.key);
    if (!parsed) continue;
    byPage.set(parsed.page, [...(byPage.get(parsed.page) ?? []), change]);
  }
  return byPage;
}

/**
 * Pages 2..n that still have no Google Doc. Page 1 is the original document; every later page is a
 * copy of the previous one, so the copies must be made in order.
 */
export function pagesNeedingCopy(pageCount: number, existingPages: Iterable<number>) {
  const known = new Set(existingPages);
  const missing: number[] = [];
  for (let page = 2; page <= pageCount; page += 1) if (!known.has(page)) missing.push(page);
  return missing;
}

/** Text range of a table cell in a Google Doc body (from documents.get), used to replace its content. */
export type DocCellRange = { startIndex: number; endIndex: number };

/**
 * Google Docs `batchUpdate` requests that replace the text of the given cells. Requests are
 * emitted from the END of the document to the START so earlier indexes stay valid while the
 * later ones are edited (a Docs API requirement).
 */
export function buildReplaceRequests(cells: { range: DocCellRange; text: string }[]) {
  const requests: Record<string, unknown>[] = [];
  for (const cell of [...cells].sort((a, b) => b.range.startIndex - a.range.startIndex)) {
    // A cell always ends with a newline that must be kept, hence endIndex - 1.
    if (cell.range.endIndex - 1 > cell.range.startIndex) requests.push({ deleteContentRange: { range: { startIndex: cell.range.startIndex, endIndex: cell.range.endIndex - 1 } } });
    if (cell.text) requests.push({ insertText: { location: { index: cell.range.startIndex }, text: cell.text } });
  }
  return requests;
}

export type SyncMode = "DRY_RUN" | "STAGING" | "PRODUCTION";

export type WriteDecision = { allowed: true; target: "NONE"; documentId: null } | { allowed: true; target: "STAGING" | "PRODUCTION"; documentId: string } | { allowed: false; reason: string };

/**
 * The single gate before any write. Real Docs are never touched unless the mode says so, the
 * matching document id exists, credentials are configured and, for production, a staging copy
 * was verified first.
 */
export function decideWrite(input: { mode: SyncMode; stagingDocumentId: string | null; externalDocumentId: string | null; stagingVerifiedAt: string | null; credentialsConfigured: boolean; writesEnabled: boolean }): WriteDecision {
  if (input.mode === "DRY_RUN") return { allowed: true, target: "NONE", documentId: null };
  if (!input.credentialsConfigured) return { allowed: false, reason: "Faltan las credenciales de Google (no se escribe nada)." };
  if (!input.writesEnabled) return { allowed: false, reason: "La escritura en Google Docs está deshabilitada (S13_GOOGLE_WRITE_ENABLED)." };
  if (input.mode === "STAGING") {
    return input.stagingDocumentId ? { allowed: true, target: "STAGING", documentId: input.stagingDocumentId } : { allowed: false, reason: "Falta el ID de la copia de prueba (staging)." };
  }
  if (!input.externalDocumentId) return { allowed: false, reason: "Falta el ID del documento real." };
  if (!input.stagingVerifiedAt) return { allowed: false, reason: "Producción exige haber verificado antes la copia de prueba (staging)." };
  return { allowed: true, target: "PRODUCTION", documentId: input.externalDocumentId };
}

/** Reconciliation: cells where the Doc disagrees with the database (the database always wins). */
export function reconcile(desired: CellMap, actual: CellMap) {
  const mismatches: { key: string; database: string | null; document: string | null }[] = [];
  for (const key of new Set([...Object.keys(desired), ...Object.keys(actual)])) {
    const database = desired[key] ?? null;
    const document = actual[key] ?? null;
    if (database !== document) mismatches.push({ key, database, document });
  }
  return mismatches.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
}

/** Accepts a Google Docs URL or a bare document id and returns the id (or null when it is neither). */
export function extractGoogleDocId(input: string) {
  const value = input.trim();
  const fromUrl = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,120})(?:[/?#].*)?$/.exec(value);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,120}$/.test(value) ? value : null;
}
