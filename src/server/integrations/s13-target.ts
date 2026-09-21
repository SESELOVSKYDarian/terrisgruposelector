import "server-only";

import { readS13Table } from "@/modules/s13/doc-table";
import { buildReplaceRequests, type CellChange, type CellMap } from "@/modules/s13/sync";
import { batchUpdate, copyDocument, getDocument } from "./google-docs";

/** Where S-13 cell changes are delivered. The database never depends on the target. Each S-13 page is its own Doc. */
export interface S13Target {
  readonly kind: "NONE" | "GOOGLE_DOCS";
  /** Non-empty managed cells of the Doc, keyed like the logical cells of `page`. */
  readCells(input: { documentId: string; page: number }): Promise<CellMap>;
  applyChanges(input: { documentId: string; page: number; changes: CellChange[] }): Promise<{ applied: number }>;
  /** Copies a Doc (data included); returns the new Doc id. */
  copyPage(input: { sourceDocumentId: string; name: string }): Promise<{ documentId: string }>;
  /** Blanks every filled data cell of a page's Doc (headers and territory numbers stay). */
  clearPage(input: { documentId: string; page: number }): Promise<void>;
}

export class IntegrationNotReadyError extends Error {}

/** Simulation: nothing is sent anywhere. */
export class DryRunTarget implements S13Target {
  readonly kind = "NONE" as const;
  async readCells() {
    return {};
  }
  async applyChanges() {
    return { applied: 0 };
  }
  async copyPage(): Promise<{ documentId: string }> {
    throw new IntegrationNotReadyError("La simulación no crea copias.");
  }
  async clearPage() {}
}

/**
 * Google Docs delivery. Cells are located by reading the Doc's own table (territory number in the
 * first column), so the layout is confirmed against the real document on every write. Edits go in one
 * atomic batchUpdate guarded by the revision id read just before.
 */
export class GoogleDocsTarget implements S13Target {
  readonly kind = "GOOGLE_DOCS" as const;

  async readCells({ documentId, page }: { documentId: string; page: number }) {
    return readS13Table((await getDocument(documentId)).body, page).cells;
  }

  async applyChanges({ documentId, page, changes }: { documentId: string; page: number; changes: CellChange[] }) {
    if (!changes.length) return { applied: 0 };
    const document = await getDocument(documentId);
    const read = readS13Table(document.body, page);
    const cells = changes.map((change) => {
      const range = read.ranges.get(change.key);
      if (!range) throw new Error(`La celda ${change.key} no existe en el documento (¿falta el territorio o cambió el formato de la tabla?).`);
      return { range, text: change.operation === "SET" ? change.value ?? "" : "" };
    });
    await batchUpdate(documentId, buildReplaceRequests(cells), document.revisionId);
    return { applied: changes.length };
  }

  async copyPage({ sourceDocumentId, name }: { sourceDocumentId: string; name: string }) {
    return { documentId: await copyDocument(sourceDocumentId, name) };
  }

  async clearPage({ documentId, page }: { documentId: string; page: number }) {
    const cells = await this.readCells({ documentId, page });
    await this.applyChanges({ documentId, page, changes: Object.keys(cells).map((key) => ({ key, operation: "CLEAR" as const, value: null })) });
  }
}

export function googleCredentialsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

/** Second, environment-level switch: writes stay off unless explicitly enabled per deployment. */
export function s13WritesEnabled() {
  return process.env.S13_GOOGLE_WRITE_ENABLED === "true";
}

/** Reading never modifies a Doc, so it only needs credentials (not the write switch). */
export function resolveReader(): S13Target {
  return googleCredentialsConfigured() ? new GoogleDocsTarget() : new DryRunTarget();
}

export function resolveTarget(target: "NONE" | "STAGING" | "PRODUCTION"): S13Target {
  return target === "NONE" ? new DryRunTarget() : new GoogleDocsTarget();
}
