"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import type { UnitState } from "@/modules/buildings/activity";
import type { Unit } from "@/modules/buildings/structure";
import { cn } from "@/lib/utils";
import { Notice, Pill } from "../ui";

export type UnitStatusView = { state: UnitState; owner_id: string | null; owner_name: string | null; blocked_until: string | null; last_worked_at: string | null; last_activity_id: string | null; mine: boolean; can_undo: boolean; can_work: boolean; block_reason: string | null };

const styles: Record<UnitState, string> = {
  DISPONIBLE: "border-border bg-foreground/[0.04] text-foreground",
  BLOQUEADO: "border-amber-400/40 bg-amber-500/15 text-amber-100",
  REVISITA: "border-violet-400/45 bg-violet-500/18 text-violet-100",
};

const dateEs = (value: string) => new Date(value).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

async function post(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No se pudo completar la acción.");
  return body;
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {[true, false].map((option) => (
          <button aria-pressed={value === option} className={cn("min-h-12 rounded-xl border text-base font-semibold transition", value === option ? "border-primary bg-primary/20 text-primary" : "border-border text-foreground/80 hover:bg-foreground/[0.05]")} key={String(option)} onClick={() => onChange(option)} type="button">{option ? "Sí" : "No"}</button>
        ))}
      </div>
    </div>
  );
}

function UnitDialog({ unit, status, building, me, meName, canManage, onClose, onChanged }: { unit: Unit; status: UnitStatusView; building: { address: string; territory_number: number }; me: string; meName: string; canManage: boolean; onClose: () => void; onChanged: (result?: Record<string, unknown>) => void }) {
  const [attended, setAttended] = useState<boolean | null>(null);
  const [interested, setInterested] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await post(action, payload);
      onChanged(result);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  const ready = attended === false || (attended === true && interested !== null);
  const showForm = status.can_work && (status.state === "DISPONIBLE" || working);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-[var(--overlay-soft)] backdrop-blur-sm sm:place-items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={`Departamento ${unit.label}`}>
      <div className="glass-panel max-h-[92vh] w-full space-y-3 overflow-y-auto rounded-t-[1.5rem] p-5 sm:max-w-md sm:rounded-[1.5rem]">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xl font-semibold text-foreground">Departamento {unit.label}</h3>
          {status.state === "REVISITA" ? <Pill tone="sky">Revisita</Pill> : status.state === "BLOQUEADO" ? <Pill tone="amber">Bloqueado</Pill> : <Pill tone="emerald">Disponible</Pill>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
          <dt>Fecha</dt><dd className="text-foreground/90">{new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}</dd>
          <dt>Usuario</dt><dd className="text-foreground/90">{meName}</dd>
          <dt>Edificio</dt><dd className="text-foreground/90">{building.address}</dd>
          <dt>Territorio</dt><dd className="text-foreground/90">{building.territory_number}</dd>
        </dl>

        {status.state === "BLOQUEADO" ? <Notice tone="warning">Bloqueado hasta el {status.blocked_until ? dateEs(status.blocked_until) : "—"}.</Notice> : null}
        {status.state === "REVISITA" ? <Notice tone="info">{status.mine ? "Es tu revisita: solo vos podés trabajarla." : `Revisita de ${status.owner_name ?? "otra persona"}: no está disponible para vos.`}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        {showForm ? (
          <div className="space-y-3">
            <YesNo label="¿Atendió?" onChange={(value) => { setAttended(value); if (!value) setInterested(null); }} value={attended} />
            {attended ? <YesNo label="¿Mostró interés?" onChange={setInterested} value={interested} /> : null}
            <button className={cn(primarySmallButtonClass, "w-full")} disabled={busy || !ready} onClick={() => void act("markUnit", { unit_id: unit.id, attended, interested: attended ? interested : null })} type="button">Guardar</button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status.state === "REVISITA" && status.mine && !working ? <button className={miniButtonClass} onClick={() => setWorking(true)} type="button">Volver a trabajar</button> : null}
          {status.state === "REVISITA" && (status.mine || canManage) ? <button className={miniButtonClass} disabled={busy} onClick={() => void act("releaseRevisit", { unit_id: unit.id })} type="button">Quitar revisita</button> : null}
          {status.state !== "DISPONIBLE" && canManage ? <button className={miniButtonClass} disabled={busy} onClick={() => void act("unlock", { scope: "UNIT", id: unit.id })} type="button">Desbloquear departamento</button> : null}
          {status.can_undo && status.last_activity_id ? <button className={miniButtonClass} disabled={busy} onClick={() => void act("undoActivity", { id: status.last_activity_id })} type="button"><Undo2 size={14} aria-hidden="true" />Deshacer último registro</button> : null}
        </div>
        <button className={cn(secondaryButtonClass, "w-full")} onClick={onClose} type="button">Cerrar</button>
        <p className="sr-only">Usuario actual {me}</p>
      </div>
    </div>
  );
}

/** One doorbell in the grid: colour = state, tap = the quick "¿Atendió? / ¿Mostró interés?" flow. */
export function UnitCell({ unit, status, building, me, meName, canManage, onChanged }: { unit: Unit; status: UnitStatusView; building: { address: string; territory_number: number }; me: string; meName: string; canManage: boolean; onChanged: (result?: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={cn("flex min-h-16 w-full flex-col items-center justify-center rounded-xl border px-1 py-2 text-center transition active:scale-[0.98]", styles[status.state])} onClick={() => setOpen(true)} type="button">
        <span className="text-base font-semibold">{unit.label}</span>
        {status.state === "BLOQUEADO" && status.blocked_until ? <span className="text-[10px] opacity-90">hasta {dateEs(status.blocked_until)}</span> : null}
        {status.state === "REVISITA" ? <span className="max-w-full truncate text-[10px] opacity-90">{status.mine ? "Tu revisita" : status.owner_name ?? "Revisita"}</span> : null}
      </button>
      {open ? <UnitDialog building={building} canManage={canManage} me={me} meName={meName} onChanged={onChanged} onClose={() => setOpen(false)} status={status} unit={unit} /> : null}
    </>
  );
}
