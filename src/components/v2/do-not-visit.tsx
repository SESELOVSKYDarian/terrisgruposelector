"use client";

import { useState } from "react";
import { TriangleAlert, Trash2 } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, Pill, fieldClass } from "./ui";
import { useModuleApi } from "./use-module-api";

/** Visible to everyone who consults an outing that includes a territory with do-not-visit addresses. */
export function DoNotVisitWarning({ items }: { items: { id: string; number: number | string; address: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-2" role="note">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200"><TriangleAlert size={13} aria-hidden="true" />No visitar</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => <li className="text-xs text-amber-100" key={item.id}>Territorio {item.number} · {item.address}</li>)}
      </ul>
    </div>
  );
}

type Item = { id: string; territory_id: string; address: string; active: boolean; created_at: string };
type State = { items: Item[]; territories: { id: string; number: number; name: string | null }[] };

/** Territorios → No visitar: only Superintendente de Servicio and Siervo de Territorios manage these. */
export function DoNotVisitPanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/do-not-visit");
  const [territory, setTerritory] = useState("");
  const [address, setAddress] = useState("");
  if (loading) return <Notice>Cargando direcciones…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudieron cargar las direcciones."}</Notice>;

  const numberOf = new Map(data.territories.map((entry) => [entry.id, entry.number]));
  const sorted = [...data.items].sort((a, b) => (numberOf.get(a.territory_id) ?? 0) - (numberOf.get(b.territory_id) ?? 0) || a.address.localeCompare(b.address));

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card title="Agregar dirección" description="La fecha en que se agrega queda registrada. Al desactivarla deja de mostrarse en las salidas pero se conserva el historial.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><Select onChange={setTerritory} options={data.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Territorio" size="compact" value={territory} /></div>
          <label className="min-w-56 flex-1 text-sm text-muted">Dirección<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setAddress(event.target.value)} placeholder="Ej. Paso 456" value={address} /></label>
          <button className={primarySmallButtonClass} disabled={busy || !territory || address.trim().length < 3} onClick={() => void run("create", { territory_id: territory, address }).then((done) => done && setAddress(""))} type="button">Agregar</button>
        </div>
      </Card>
      {sorted.length ? (
        <div className="space-y-2">
          {sorted.map((item) => (
            <div className={cn("flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2", !item.active && "opacity-55")} key={item.id}>
              <span className="w-28 text-sm font-medium text-foreground">Territorio {numberOf.get(item.territory_id) ?? "?"}</span>
              <span className="min-w-40 flex-1 text-sm text-foreground/90">{item.address}</span>
              <span className="text-xs text-muted">Agregada {new Date(item.created_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</span>
              {item.active ? <Pill tone="amber">Activa</Pill> : <Pill tone="slate">Inactiva</Pill>}
              <button className={miniButtonClass} disabled={busy} onClick={() => void run("setActive", { id: item.id, active: !item.active })} type="button">{item.active ? "Desactivar" : "Reactivar"}</button>
              <button aria-label="Eliminar dirección" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:text-rose-300" disabled={busy} onClick={() => void run("delete", { id: item.id })} type="button"><Trash2 size={15} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      ) : (
        <Empty>Todavía no hay direcciones No visitar.</Empty>
      )}
    </div>
  );
}
