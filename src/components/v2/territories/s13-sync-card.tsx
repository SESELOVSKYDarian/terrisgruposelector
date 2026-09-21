"use client";

import { useState } from "react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import { Card, Notice, Pill, fieldClass } from "../ui";

export type SyncInfo = {
  mode: "DRY_RUN" | "STAGING" | "PRODUCTION";
  staging_document_id: string | null;
  external_document_id: string | null;
  staging_verified_at: string | null;
  last_synced_at: string | null;
  credentials_configured: boolean;
  writes_enabled: boolean;
  blocked_reason: string | null;
  runs: { id: string; mode: string; status: string; started_at: string; summary: { changes?: number; unchanged?: number } | null; error: string | null }[];
};

type RunResult = { status: string; mode: string; changes: number; unchanged: number; cells: number; reason: string | null; sample: { key: string; operation: string; value: string | null }[] };

async function post(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/v2/s13", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No se pudo completar la acción.");
  return body;
}

const modeLabels = { DRY_RUN: "Simulación", STAGING: "Copia de prueba", PRODUCTION: "Documento real" } as const;
const statusTone = { SIMULATED: "sky", SENT: "emerald", FAILED: "rose", BLOCKED: "amber", RUNNING: "slate" } as const;

/**
 * Google Docs sync for one S-13 document. It starts (and stays) in simulation: nothing is written
 * anywhere until a mode, the document links, credentials and the environment switch all agree.
 */
export function S13SyncCard({ code, sync, onChanged }: { code: string; sync: SyncInfo; onChanged: () => void }) {
  const [mode, setMode] = useState(sync.mode);
  const [staging, setStaging] = useState(sync.staging_document_id ?? "");
  const [external, setExternal] = useState(sync.external_document_id ?? "");
  const [verified, setVerified] = useState(Boolean(sync.staging_verified_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Sincronización con Google Docs" description="La base de datos es la fuente de verdad: el Doc es solo su representación. Por ahora solo se simula lo que se enviaría." action={<Pill tone={sync.mode === "DRY_RUN" ? "sky" : "amber"}>{modeLabels[sync.mode]}</Pill>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {sync.blocked_reason ? <Notice tone="warning">{sync.blocked_reason}</Notice> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52"><Select onChange={(value) => setMode(value as SyncInfo["mode"])} options={(Object.keys(modeLabels) as (keyof typeof modeLabels)[]).map((key) => ({ value: key, label: modeLabels[key] }))} size="compact" value={mode} /></div>
        <label className="min-w-64 flex-1 text-xs text-muted">Copia de prueba (link o ID)<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setStaging(event.target.value)} placeholder="https://docs.google.com/document/d/…" value={staging} /></label>
        <label className="min-w-64 flex-1 text-xs text-muted">Documento real (link o ID)<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setExternal(event.target.value)} placeholder="https://docs.google.com/document/d/…" value={external} /></label>
        <label className="flex items-center gap-2 text-xs text-muted"><input checked={verified} onChange={(event) => setVerified(event.target.checked)} type="checkbox" />Copia de prueba verificada</label>
        <button className={miniButtonClass} disabled={busy} onClick={() => void run(async () => { await post("configure", { code, sync_mode: mode, staging_document: staging || null, external_document: external || null, staging_verified: verified }); onChanged(); })} type="button">Guardar configuración</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={primarySmallButtonClass} disabled={busy} onClick={() => void run(async () => { setResult((await post("sync", { code })) as RunResult); onChanged(); })} type="button">{sync.mode === "DRY_RUN" ? "Simular sincronización" : "Sincronizar"}</button>
        <span className="text-xs text-muted">Credenciales de Google: {sync.credentials_configured ? "configuradas" : "sin configurar"} · Escritura: {sync.writes_enabled ? "habilitada" : "deshabilitada"}{sync.last_synced_at ? ` · última sincronización ${new Date(sync.last_synced_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : ""}</span>
      </div>

      {result ? (
        <Notice tone={result.status === "FAILED" ? "error" : result.status === "BLOCKED" ? "warning" : "success"}>
          {result.status === "SIMULATED" ? "Simulación lista: " : result.status === "SENT" ? "Enviado: " : result.status === "BLOCKED" ? "Bloqueado: " : "Falló: "}
          {result.changes} celda{result.changes === 1 ? "" : "s"} cambiar{result.changes === 1 ? "ía" : "ían"}, {result.unchanged} sin cambios{result.reason ? ` · ${result.reason}` : ""}.
        </Notice>
      ) : null}
      {result?.sample.length ? (
        <ul className="max-h-48 overflow-y-auto rounded-lg bg-black/20 p-2 font-mono text-xs text-foreground/90">
          {result.sample.map((change) => <li key={change.key}>{change.operation} {change.key}{change.value ? ` = ${change.value}` : ""}</li>)}
        </ul>
      ) : null}

      {sync.runs.length ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted">Últimos intentos</p>
          {sync.runs.map((entry) => (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted" key={entry.id}>
              <Pill tone={statusTone[entry.status as keyof typeof statusTone] ?? "slate"}>{entry.status}</Pill>
              <span>{new Date(entry.started_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</span>
              <span>{modeLabels[entry.mode as keyof typeof modeLabels] ?? entry.mode}</span>
              {entry.summary?.changes !== undefined ? <span>{entry.summary.changes} cambios</span> : null}
              {entry.error ? <span className="text-amber-300">{entry.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
