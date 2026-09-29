import "server-only";

import { diffCells, decideWrite, extractGoogleDocId, groupChangesByPage, pagesNeedingCopy, pagesToCells, reconcile, type CellChange, type CellMap, type SyncMode } from "@/modules/s13/sync";
import { googleCredentialsConfigured, resolveReader, resolveTarget, s13WritesEnabled } from "@/server/integrations/s13-target";
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

type PageDoc = { documentId: string; prepared: boolean };

/** Google Doc of every page for one destination: page 1 is the original, later pages are the copies. */
async function loadPageDocs(supabase: AdminSupabase, document: DocumentRow, target: "STAGING" | "PRODUCTION") {
  const docs = new Map<number, PageDoc>();
  const first = target === "STAGING" ? document.staging_document_id : document.external_document_id;
  if (first) docs.set(1, { documentId: first, prepared: true });
  const { data, error } = await supabase.from("s13_document_pages").select("page, google_document_id, prepared_at").eq("document_id", document.id).eq("target", target);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) docs.set(row.page as number, { documentId: row.google_document_id as string, prepared: Boolean(row.prepared_at) });
  return docs;
}

/**
 * Creates the Docs for pages that have no Doc yet (each is a copy of the previous page, blanked) and
 * finishes any copy that was left half-prepared. Returns how many were created.
 */
async function ensurePageDocs(supabase: AdminSupabase, document: DocumentRow, target: "STAGING" | "PRODUCTION", pageCount: number, docs: Map<number, PageDoc>) {
  const client = resolveTarget(target);
  let created = 0;
  for (const page of pagesNeedingCopy(pageCount, docs.keys())) {
    const source = docs.get(page - 1);
    if (!source) throw new Error(`No se puede crear la hoja ${page}: falta el documento de la hoja ${page - 1}.`);
    const copy = await client.copyPage({ sourceDocumentId: source.documentId, name: `${document.title} - hoja ${page}` });
    const { error } = await supabase.from("s13_document_pages").insert({ document_id: document.id, page, target, google_document_id: copy.documentId });
    if (error) throw new Error(`Se creó la copia ${copy.documentId} pero no se pudo registrar: ${error.message}`);
    docs.set(page, { documentId: copy.documentId, prepared: false });
    created += 1;
  }
  for (const [page, doc] of [...docs.entries()].sort((a, b) => a[0] - b[0])) {
    if (doc.prepared) continue;
    await client.clearPage({ documentId: doc.documentId, page });
    await supabase.from("s13_document_pages").update({ prepared_at: new Date().toISOString() }).eq("document_id", document.id).eq("page", page).eq("target", target);
    doc.prepared = true;
  }
  return created;
}

/**
 * Computes what the Docs would receive (only differences from the last successful sync) and
 * records the attempt. In DRY_RUN — the default — nothing leaves the database. Any write goes
 * through decideWrite(); a blocked run is recorded, never silently skipped. Every S-13 page is its
 * own Google Doc: when a territory runs out of rounds the previous page's Doc is copied and blanked.
 */
export async function runS13Sync(supabase: AdminSupabase, actorId: string | null, code: string) {
  const document = await loadDocument(supabase, code);
  const { pages } = await loadS13Document(supabase, document);
  const desired = pagesToCells(pages);
  const snapshot = await readSnapshot(supabase, document.id);
  const { changes, unchanged } = diffCells(desired, snapshot);
  const decision = writeDecisionFor(document);

  const { data: run, error } = await supabase.from("s13_sync_runs").insert({ document_id: document.id, mode: document.sync_mode, triggered_by: actorId }).select("id").single();
  if (error || !run) throw new Error(error?.message ?? "No se pudo registrar la sincronización.");
  const summaryBase = { changes: changes.length, unchanged, cells: Object.keys(desired).length, pages: pages.length };
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
    const client = resolveTarget(decision.target);
    const docs = await loadPageDocs(supabase, document, decision.target);
    const createdPages = await ensurePageDocs(supabase, document, decision.target, pages.length, docs);

    let applied = 0;
    for (const [page, pageChanges] of [...groupChangesByPage(changes).entries()].sort((a, b) => a[0] - b[0])) {
      const doc = docs.get(page);
      if (!doc) throw new Error(`La hoja ${page} no tiene documento de Google.`);
      applied += (await client.applyChanges({ documentId: doc.documentId, page, changes: pageChanges })).applied;
      const sets = pageChanges.filter((change) => change.operation === "SET");
      for (let start = 0; start < sets.length; start += 500) {
        await supabase.from("s13_sync_snapshots").upsert(sets.slice(start, start + 500).map((change) => ({ document_id: document.id, cell_key: change.key, value: change.value as string, synced_at: new Date().toISOString() })), { onConflict: "document_id,cell_key" });
      }
      const clears = pageChanges.filter((change) => change.operation === "CLEAR").map((change) => change.key);
      for (let start = 0; start < clears.length; start += 200) await supabase.from("s13_sync_snapshots").delete().eq("document_id", document.id).in("cell_key", clears.slice(start, start + 200));
      const keys = pageChanges.map((change) => change.key);
      for (let start = 0; start < keys.length; start += 200) await supabase.from("s13_sync_outbox").update({ status: "SENT" }).eq("run_id", run.id).in("cell_key", keys.slice(start, start + 200));
    }
    await supabase.from("s13_documents").update({ last_synced_at: new Date().toISOString() }).eq("id", document.id);
    return finish("SENT", { applied, target: decision.target, pages_created: createdPages });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Error inesperado.";
    await supabase.from("s13_sync_outbox").update({ status: "FAILED", last_error: message }).eq("run_id", run.id).eq("status", "PENDING");
    return finish("FAILED", {}, message);
  }
}

/**
 * Read-only check of the Docs against the database (safe on the real documents: nothing is written).
 * Lists the cells where they disagree so a staging copy can be verified before going to production.
 */
export async function compareWithDocuments(supabase: AdminSupabase, code: string) {
  const document = await loadDocument(supabase, code);
  if (!googleCredentialsConfigured()) throw new ApiError("Faltan las credenciales de Google para leer los documentos.", 409);
  const target = document.sync_mode === "STAGING" ? "STAGING" : "PRODUCTION";
  const docs = await loadPageDocs(supabase, document, target);
  if (!docs.size) throw new ApiError(target === "STAGING" ? "Falta el link de la copia de prueba." : "Falta el link del documento real.", 409);
  const { pages } = await loadS13Document(supabase, document);
  const desired = pagesToCells(pages);
  const reader = resolveReader();
  const mismatches: ReturnType<typeof reconcile> = [];
  for (const [page, doc] of [...docs.entries()].sort((a, b) => a[0] - b[0])) {
    const expected = Object.fromEntries(Object.entries(desired).filter(([key]) => key.startsWith(`p${page}/`)));
    mismatches.push(...reconcile(expected, await reader.readCells({ documentId: doc.documentId, page })));
  }
  return { target, pages_compared: docs.size, database_pages: pages.length, total: mismatches.length, mismatches: mismatches.slice(0, 100) };
}

/** Cron entry point: keeps every document that is past simulation up to date. Errors never stop the others. */
export async function runScheduledS13Sync(supabase: AdminSupabase) {
  const { data, error } = await supabase.from("s13_documents").select("code").neq("sync_mode", "DRY_RUN");
  if (error) throw new Error(error.message);
  let synced = 0;
  for (const row of data ?? []) {
    try {
      const result = await runS13Sync(supabase, null, row.code as string);
      if (result.status === "SENT") synced += 1;
    } catch (cause) {
      console.error(`Falló la sincronización programada del S-13 ${row.code}:`, cause);
    }
  }
  return synced;
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
  // The snapshot describes what ONE destination already holds: a new destination starts from scratch.
  if (input.sync_mode !== document.sync_mode || stagingId !== document.staging_document_id || externalId !== document.external_document_id) {
    await supabase.from("s13_sync_snapshots").delete().eq("document_id", document.id);
  }
  await writeAudit(supabase, { actorId, action: "S13_SYNC_CONFIGURED", entityType: "s13_document", entityId: document.id, before: { mode: document.sync_mode, staging: document.staging_document_id, external: document.external_document_id }, after: { mode: patch.sync_mode, staging: stagingId, external: externalId, verified: Boolean(patch.staging_verified_at) } });
  return {};
}
