"use client";

import { useState } from "react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { formatS13Date } from "@/modules/s13/layout";
import { Card, Notice, Pill, fieldClass } from "../ui";

export type TestInfo = {
  entries: { id: string; territory_number: number; conductor: string; assigned_on: string; completed_on: string | null }[];
  conductors: { id: string; name: string }[];
};

async function post(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/v2/s13", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No se pudo completar la acción.");
  return body;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Test area: entries are written to the real S-13 (flagged as test) and can be deleted afterwards; real rounds are untouched. */
export function S13TestCard({ tests, onChanged }: { tests: TestInfo; onChanged: () => void }) {
  const [territory, setTerritory] = useState("");
  const [conductor, setConductor] = useState("");
  const [assigned, setAssigned] = useState(today());
  const [completed, setCompleted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Number(territory) > 0 && conductor && assigned;

  return (
    <Card title="Campo de pruebas" description="Agrega una vuelta de prueba al S-13 de la app y después la borrás. No se sincroniza con el documento de Drive. Solo se pueden borrar las entradas creadas desde acá; las reales no se tocan.">
      <div className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-xs text-muted">Territorio<input className={fieldClass} inputMode="numeric" onChange={(event) => setTerritory(event.target.value.replace(/\D/g, ""))} value={territory} /></label>
          <label className="grid gap-1 text-xs text-muted">Conductor
            <Select onChange={setConductor} options={[{ value: "", label: "Elegir…" }, ...tests.conductors.map((entry) => ({ value: entry.id, label: entry.name }))]} value={conductor} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Fecha asignada<input className={fieldClass} onChange={(event) => setAssigned(event.target.value)} type="date" value={assigned} /></label>
          <label className="grid gap-1 text-xs text-muted">Fecha completada (opcional)<input className={fieldClass} min={assigned} onChange={(event) => setCompleted(event.target.value)} type="date" value={completed} /></label>
          <div className="flex items-end">
            <button className={primarySmallButtonClass} disabled={busy || !ready} onClick={() => run(async () => { await post("test_create", { territory_number: Number(territory), conductor_id: conductor, assigned_on: assigned, completed_on: completed || null }); setTerritory(""); setCompleted(""); })} type="button">Agregar entrada de prueba</button>
          </div>
        </div>
        {tests.entries.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tests.entries.map((entry) => (
              <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" key={entry.id}>
                <Pill tone="amber">Prueba</Pill>
                <span className="font-semibold">Terr. {entry.territory_number}</span>
                <span>{entry.conductor}</span>
                <span className="text-muted">{formatS13Date(entry.assigned_on)} → {entry.completed_on ? formatS13Date(entry.completed_on) : "abierta"}</span>
                <button className={`${miniButtonClass} ml-auto`} disabled={busy} onClick={() => run(() => post("test_delete", { id: entry.id }))} type="button">Borrar</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No hay entradas de prueba.</p>
        )}
      </div>
    </Card>
  );
}
