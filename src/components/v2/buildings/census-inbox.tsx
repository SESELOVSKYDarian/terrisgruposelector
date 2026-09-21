"use client";

import { useState } from "react";
import { Camera, Check, Pencil, X } from "lucide-react";
import { miniButtonClass } from "@/app/_components/ui-classes";
import { censusReasonLabels, describeDiff, type CensusReason, type DiffOp } from "@/modules/buildings/structure";
import { Card, Notice, Pill } from "../ui";

export type CensusRow = { id: string; building_id: string; address: string; territory_number: number; reason: CensusReason; description: string | null; diff: DiffOp[] | null; base_version: number; current_version: number; has_photo: boolean; reporter: string | null; created_at: string };

/** Managers review "falta censar" reports: apply the structured fix, open the editor with the evidence, or dismiss. */
export function CensusInbox({ items, run, busy, onOpenEditor }: { items: CensusRow[]; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean; onOpenEditor: (row: CensusRow) => void }) {
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  if (!items.length) return null;

  async function showPhoto(id: string) {
    const response = await fetch(`/api/v2/buildings?censusPhoto=${id}`, { credentials: "same-origin" });
    const body = await response.json();
    setPhotos((current) => ({ ...current, [id]: response.ok ? (body.photo as string | null) : null }));
  }

  async function apply(row: CensusRow) {
    const done = await run("applyCorrection", { id: row.id });
    // A conflict is reported by the hook's error banner; keep a hint next to the report too.
    if (!done) setMessage((current) => ({ ...current, [row.id]: "No se aplicó. Si hubo conflicto de versión, abrí el editor y revisalo a mano." }));
  }

  return (
    <Card title="Falta censar" description="Aplicar solo funciona si el edificio sigue en la versión que vio quien informó; si cambió, no se sobrescribe nada.">
      {items.map((row) => {
        const stale = row.base_version !== row.current_version;
        return (
          <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3" data-entity-id={row.id} key={row.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{row.address} <span className="text-muted">· Territorio {row.territory_number}</span></p>
              <div className="flex gap-1.5"><Pill tone="amber">{censusReasonLabels[row.reason]}</Pill>{stale ? <Pill tone="rose">Versión cambiada</Pill> : null}</div>
            </div>
            <p className="text-xs text-muted">{row.reporter ? `${row.reporter} · ` : ""}{new Date(row.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}</p>
            {row.description ? <p className="whitespace-pre-wrap text-sm text-foreground/90">{row.description}</p> : null}
            {row.diff ? <p className="rounded-lg bg-black/20 px-2 py-1 font-mono text-xs text-foreground/90">{describeDiff(row.diff)}</p> : <p className="text-xs text-muted">Sin propuesta estructurada: revisala en el editor con la evidencia.</p>}
            {row.has_photo ? (photos[row.id] ? <img alt="Foto del informe" className="max-h-64 rounded-lg" src={photos[row.id]!} /> : <button className={miniButtonClass} onClick={() => void showPhoto(row.id)} type="button"><Camera size={14} aria-hidden="true" />Ver foto</button>) : null}
            {message[row.id] ? <Notice tone="warning">{message[row.id]}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              {row.diff ? <button className={miniButtonClass} disabled={busy || stale} onClick={() => void apply(row)} title={stale ? "El edificio cambió: revisalo en el editor" : undefined} type="button"><Check size={14} aria-hidden="true" />Aplicar corrección</button> : null}
              <button className={miniButtonClass} onClick={() => onOpenEditor(row)} type="button"><Pencil size={14} aria-hidden="true" />Abrir editor</button>
              <button className={miniButtonClass} disabled={busy} onClick={() => void run("dismissCensus", { id: row.id })} type="button"><X size={14} aria-hidden="true" />Descartar</button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
