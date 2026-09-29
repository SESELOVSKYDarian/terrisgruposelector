"use client";

import { useEffect, useState } from "react";
import { formatS13Date, type S13Page } from "@/modules/s13/layout";
import { miniButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, SubTabs } from "../ui";
import { S13TestCard, type TestInfo } from "./s13-test-card";
import type { SyncInfo } from "./s13-sync-card";

type Doc = { code: string; title: string; first_territory: number; last_territory: number };
type State = { documents: Doc[]; selected: { document: Doc; pages: S13Page[] } | null; sync?: SyncInfo | null; tests?: TestInfo | null };
type SyncResult = { status: string; changes: number; unchanged: number; reason: string | null };

const th = "border border-border px-2 py-1.5 text-center text-xs font-semibold text-muted";
const td = "border border-border px-2 py-1 text-center text-sm text-foreground";

/** Read-only S-13 generated from the rounds in the database, laid out like the real document. */
export function S13View() {
  const [code, setCode] = useState("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [locateRoundId, setLocateRoundId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/v2/s13${code ? `?doc=${encodeURIComponent(code)}` : ""}`, { credentials: "same-origin" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el S-13.");
        if (!active) return;
        const nextState = body as State;
        setState(nextState);
        setError("");
        if (locateRoundId && nextState.selected) {
          const found = nextState.selected.pages.find((entry) => entry.rows.some((row) => row.slots.some((slot) => slot?.round_id === locateRoundId)));
          if (found) setPage(found.page);
          setLocateRoundId(null);
        }
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Error inesperado."));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, refresh]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!state) return <Notice>Cargando S-13…</Notice>;
  if (!state.selected) return <Empty>No hay documentos S-13 configurados.</Empty>;

  const { document, pages } = state.selected;
  const current = pages.find((entry) => entry.page === page) ?? pages[0];

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch("/api/v2/s13", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", payload: { code: document.code } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "No se pudo sincronizar.");
      setSyncResult(body as SyncResult);
    } catch (cause) {
      setSyncResult({ status: "FAILED", changes: 0, unchanged: 0, reason: cause instanceof Error ? cause.message : "Error inesperado." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <SubTabs onChange={(next) => { setCode(next); setPage(1); setSyncResult(null); }} tabs={state.documents.map((entry) => ({ id: entry.code, label: entry.title }))} value={document.code} />
      {state.tests ? <S13TestCard onChanged={(createdRoundId) => { setLocateRoundId(createdRoundId ?? null); setRefresh((value) => value + 1); }} tests={state.tests} /> : null}
      {state.tests ? (
        <div className="flex flex-wrap items-center gap-3">
          <button className={miniButtonClass} disabled={syncing} onClick={() => void syncNow()} type="button">{syncing ? "Sincronizando…" : "Sincronizar ahora con Google Docs"}</button>
          {syncResult ? (
            <Notice tone={syncResult.status === "FAILED" || syncResult.status === "BLOCKED" ? "error" : "success"}>
              {syncResult.status === "SENT" ? `Enviado: ${syncResult.changes} celda${syncResult.changes === 1 ? "" : "s"} actualizada${syncResult.changes === 1 ? "" : "s"}.` : syncResult.status === "SIMULATED" ? `Simulado: ${syncResult.changes} cambio${syncResult.changes === 1 ? "" : "s"} (no configurado para escribir).` : syncResult.reason ?? "No se pudo sincronizar."}
            </Notice>
          ) : null}
        </div>
      ) : null}
      <Card title={document.title} description="Se genera desde las vueltas registradas: la base de datos es la fuente de verdad y este documento es solo su representación.">
        {pages.length > 1 ? <SubTabs onChange={(next) => setPage(Number(next))} tabs={pages.map((entry) => ({ id: String(entry.page), label: `Página ${entry.page}` }))} value={String(current?.page ?? 1)} /> : null}
        {current ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className={th} rowSpan={2}>Terr. N.º</th>
                  <th className={th} rowSpan={2}>Última fecha en que se completó</th>
                  {[1, 2, 3, 4].map((slot) => <th className={th} colSpan={2} key={slot}>Asignado a</th>)}
                </tr>
                <tr>{[1, 2, 3, 4].map((slot) => [<th className={th} key={`a${slot}`}>Fecha asignada</th>, <th className={th} key={`c${slot}`}>Fecha en que se completó</th>])}</tr>
              </thead>
              <tbody>
                {current.rows.map((row) => [
                  <tr key={`${row.territory_number}-top`}>
                    <td className={cn(td, "font-semibold")} rowSpan={2}>{row.territory_number}</td>
                    <td className={td} rowSpan={2}>{formatS13Date(row.last_completed_on)}</td>
                    {row.slots.map((slot, index) => <td className={cn(td, "font-medium", slot?.is_test && "bg-amber-400/15 text-amber-300")} colSpan={2} key={index}>{slot?.conductor ?? ""}{slot?.is_test ? " (prueba)" : ""}</td>)}
                  </tr>,
                  <tr key={`${row.territory_number}-bottom`}>
                    {row.slots.map((slot, index) => [<td className={cn(td, slot?.is_test && "bg-amber-400/15")} key={`a${index}`}>{formatS13Date(slot?.assigned_on)}</td>, <td className={cn(td, slot?.is_test && "bg-amber-400/15")} key={`c${index}`}>{formatS13Date(slot?.completed_on)}</td>])}
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No hay territorios en este rango.</Empty>
        )}
      </Card>
    </div>
  );
}
