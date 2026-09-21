import "server-only";

import type { CellChange } from "@/modules/s13/sync";

/** Where S-13 cell changes are delivered. The database never depends on the target. */
export interface S13Target {
  readonly kind: "NONE" | "GOOGLE_DOCS";
  applyChanges(input: { documentId: string; firstTerritory: number; changes: CellChange[] }): Promise<{ applied: number }>;
}

export class IntegrationNotReadyError extends Error {}

/** Simulation: nothing is sent anywhere. */
export class DryRunTarget implements S13Target {
  readonly kind = "NONE" as const;
  async applyChanges() {
    return { applied: 0 };
  }
}

/**
 * Google Docs delivery. The pure pieces (logical cell → table row/column, batchUpdate request
 * builder, write gate) live in modules/s13/sync.ts and are tested. What is intentionally NOT
 * written yet, because it cannot be verified without the real documents:
 *   1. service-account OAuth (JWT) using GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY;
 *   2. documents.get to locate each table cell's {startIndex, endIndex} on the staging copy;
 *   3. documents.batchUpdate with buildReplaceRequests().
 * Until those exist it refuses to run, so no real Doc can be touched by accident.
 */
export class GoogleDocsTarget implements S13Target {
  readonly kind = "GOOGLE_DOCS" as const;
  async applyChanges(): Promise<{ applied: number }> {
    throw new IntegrationNotReadyError("El cliente de Google Docs todavía no está habilitado: falta verificarlo contra la copia de prueba del documento real.");
  }
}

export function googleCredentialsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

/** Second, environment-level switch: writes stay off unless explicitly enabled per deployment. */
export function s13WritesEnabled() {
  return process.env.S13_GOOGLE_WRITE_ENABLED === "true";
}

export function resolveTarget(target: "NONE" | "STAGING" | "PRODUCTION"): S13Target {
  return target === "NONE" ? new DryRunTarget() : new GoogleDocsTarget();
}
