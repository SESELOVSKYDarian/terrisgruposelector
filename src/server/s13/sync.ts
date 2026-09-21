import "server-only";

import { diffCells, decideWrite, extractGoogleDocId, pagesToCells, type CellChange, type CellMap, type SyncMode } from "@/modules/s13/sync";
import { googleCredentialsConfigured, resolveTarget, s13WritesEnabled } from "@/server/integrations/s13-target";
import { ApiError } from "@/server/api";
import { writeAudit, type AdminSupabase } from "@/server/outings/planning";
import { loadS13Document } from "./index";

type DocumentRow = { id: string; code: string; title: string; first_territory: number; last_territory: number; external_document_id: string | null; staging_document_id: string | null; sync_mode: SyncMode; staging_verified_at: string | null; last_synced_at: string | null };

const DOCUMENT_COLUMNS = "id, code, title, first_territory, last_territory, external_document_id, staging_document_id, sync_mode, staging_verified_at, last_synced_at";

async function loadDocument(supabase: AdminSupabase, code: string): Promise<DocumentRow> {
  const { data, error } = await supabase.from("s13_documents").select(DOCUMENT_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ApiError("Documento S-13 no encontrado.", 404);
  return data as DocumentRow;
}

export function writeDecisionFor(document: DocumentRow) {
  return decideWrite({ mode: document.sync_mode, stagingDocumentId: document.staging_document_id, externalDocumentId: document.external_document_id, stagingVerifiedAt: document.staging_verified_at, credentialsConfigured: googleCredentialsConfigured(), writesEnabled: s13WritesEnabled() });
}

export async function syncStatus(supabase: AdminSupabase, code: string) {
  const document = await loadDocument(supabase, code);
  const decision = writeDecisionFor(document);
  const { data: runs, error } = await supabase.from("s13_sync_runs").select("id, mode, status, started_at, finished_at, summary, error").eq("document_id", document.id).order("started_at", { ascending: false }).limit(5);
  if (error) throw new Error(error.message);
  return {
    mode: document.sync_mode,
    staging_document_id: document.staging_document_id,
    external_document_id: document.external_document_id,
    staging_verified_at: document.staging_verified_at,
    last_synced_at: document.last_synced_at,
    credentials_configured: googleCredentialsConfigured(),
    writes_enabled: s13WritesEnabled(),
    blocked_reason: decision.allowed ? null : decision.reason,
    runs: runs ?? [],
  };
}

async function readSnapshot(supabase: AdminSupabase, documentId: string): Promise<CellMap> {
  const { data, error } = await supabase.from("s13_sync_snapshots").select("cell_key, value").eq("document_id", documentId);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.cell_key as string, row.value as string]));
}

async function insertOutbox(supabase: AdminSupabase, runId: string, documentId: string, changes: CellChange[], status: "PENDING" | "SKIPPED") {
  for (let start = 0; start < changes.length; start += 500) {
    const { error } = await supabase.from("s13_sync_outbox").insert(changes.slice(start, start + 500).map((change) => ({ run_id: runId, document_id: documentId, cell_key: change.key, operation: change.operation, value: change.value, status })));
    if (error) throw new Error(error.message);
  }
}

/**
 * Computes what the Doc would receive (only differences from the last successful sync) and
 * records the attempt. In DRY_RUN — the default — nothing leaves the database. Any write goes
 * through decideWrite(); a blocked run is recorded, never silently skipped.
 */
export async function runS13Sync(supabase: AdminSupabase, actorId: string, code: string) {
  const document = await loadDocument(supabase, code);
  const { pages } = await loadS13Document(supabase, document);
  const desired = pagesToCells(pages);
  const snapshot = await readSnapshot(supabase, document.id);
  const { changes, unchanged } = diffCells(desired, snapshot);
  const decision = writeDecisionFor(document);

  const { data: run, error } = await supabase.from("s13_sync_runs").insert({ document_id: document.id, mode: document.sync_mode, triggered_by: actorId }).select("id").single();
  if (error || !run) throw new Error(error?.message ?? "No se pudo registrar la sincronización.");
  const summaryBase = { changes: changes.length, unchanged, cells: Object.keys(desired).length };
  const finish = async (status: "SIMULATED" | "SENT" | "FAILED" | "BLOCKED", extra: Record<string, unknown> = {}, failure: string | null = null) => {
    await supabase.from("s13_sync_runs").update({ status, finished_at: new Date().toISOString(), summary: { ...summaryBase, ...extra }, error: failure }).eq("id", run.id);
    await writeAudit(supabase, { actorId, action: "S13_SYNC_RUN", entityType: "s13_document", entityId: document.id, metadata: { run_id: run.id, mode: document.sync_mode, status, ...summaryBase } });
    return { run_id: run.id as string, status, mode: document.sync_mode, ...summaryBase, sample: changes.slice(0, 50), reason: failure };
  };

  if (!decision.allowed) {
    await insertOutbox(supabase, run.id as string, document.id, changes, "SKIPPED");
    return finish("BLOCKED", { blocked: true }, decision.reason);
  }
  if (decision.target === "NONE") {
    await insertOutbox(supabase, run.id as string, document.id, changes, "SKIPPED");
    return finish("SIMULATED", { simulated: true });
  }

  await insertOutbox(supabase, run.id as string, document.id, changes, "PENDING");
  try {
    const applied = await resolveTarget(decision.target).applyChanges({ documentId: decision.documentId, firstTerritory: document.first_territory, changes });
    await supabase.from("s13_sync_outbox").update({ status: "SENT" }).eq("run_id", run.id).eq("status", "PENDING");
    const sets = changes.filter((change) => change.operation === "SET");
    for (let start = 0; start < sets.length; start += 500) {
      await supabase.from("s13_sync_snapshots").upsert(sets.slice(start, start + 500).map((change) => ({ document_id: document.id, cell_key: change.key, value: change.value as string, synced_at: new Date().toISOString() })), { onConflict: "document_id,cell_key" });
    }
    for (const change of changes.filter((entry) => entry.operation === "CLEAR")) await supabase.from("s13_sync_snapshots").delete().eq("document_id", document.id).eq("cell_key", change.key);
    await supabase.from("s13_documents").update({ last_synced_at: new Date().toISOString() }).eq("id", document.id);
    return finish("SENT", { applied: applied.applied, target: decision.target });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Error inesperado.";
    await supabase.from("s13_sync_outbox").update({ status: "FAILED", last_error: message }).eq("run_id", run.id).eq("status", "PENDING");
    return finish("FAILED", {}, message);
  }
}

export type ConfigureInput = { code: string; sync_mode: SyncMode; staging_document: string | null; external_document: string | null; staging_verified: boolean };

/** Managers of the S-13 pick the mode and paste the Doc links; every change is audited. */
export async function configureSync(supabase: AdminSupabase, actorId: string, input: ConfigureInput) {
  const document = await loadDocument(supabase, input.code);
  const stagingId = input.staging_document ? extractGoogleDocId(input.staging_document) : null;
  const externalId = input.external_document ? extractGoogleDocId(input.external_document) : null;
  if (input.staging_document && !stagingId) throw new ApiError("El link o ID de la copia de prueba no es válido.", 422);
  if (input.external_document && !externalId) throw new ApiError("El link o ID del documento real no es válido.", 422);
  if (stagingId && externalId && stagingId === externalId) throw new ApiError("La copia de prueba no puede ser el mismo documento que el real.", 422);
  if (input.sync_mode === "STAGING" && !stagingId) throw new ApiError("Para el modo STAGING falta el link de la copia de prueba.", 422);
  if (input.sync_mode === "PRODUCTION" && (!externalId || !input.staging_verified)) throw new ApiError("Producción necesita el documento real y haber verificado la copia de prueba.", 422);

  const patch = { sync_mode: input.sync_mode, staging_document_id: stagingId, external_document_id: externalId, staging_verified_at: input.staging_verified && stagingId ? document.staging_verified_at ?? new Date().toISOString() : null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("s13_documents").update(patch).eq("id", document.id);
  if (error) throw new Error(error.message);
  await writeAudit(supabase, { actorId, action: "S13_SYNC_CONFIGURED", entityType: "s13_document", entityId: document.id, before: { mode: document.sync_mode, staging: document.staging_document_id, external: document.external_document_id }, after: { mode: patch.sync_mode, staging: stagingId, external: externalId, verified: Boolean(patch.staging_verified_at) } });
  return {};
}
