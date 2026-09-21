"use client";

import { useState } from "react";
import { CheckCircle2, Plus, TriangleAlert, X } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass, secondaryButtonClass } from "@/app/_components/ui-classes";
import { formatDateEs } from "@/modules/outings/time";
import { cn } from "@/lib/utils";
import { useHighlight } from "../highlight";
import { DoNotVisitWarning } from "../do-not-visit";
import { Card, Empty, Notice, Pill, SubTabs, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type Territory = { territory_id: string; number: string | number; name: string | null; labels: string[]; prior_done: string[]; do_not_visit?: string[] };
type Entry = Territory & { done_labels: string[]; planned: boolean; round_closed?: boolean };
type Report = { id: string; notes: string | null; submitted_by_name: string | null; on_behalf: boolean; entries: (Entry & { pending_labels: string[] })[] };
type Slot = { id: string; slot_date: string; hora: string | null; lugar: string | null; status: string; conductor_name: string | null; mine: boolean; overdue: boolean; territories: Territory[]; report: Report | null };
type State = { me: string; canReportForOthers: boolean; slots: Slot[]; territories: { id: string; number: string | number; name: string | null }[] };

const dayNames = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const dayLabel = (date: string) => `${dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${formatDateEs(date).slice(0, 5)}`;

function ReportForm({ slot, state, onCancel, run, busy }: { slot: Slot; state: State; onCancel: () => void; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const initial: Entry[] = slot.report
    ? slot.report.entries.map((entry) => ({ ...entry }))
    : slot.territories.map((territory) => ({ ...territory, done_labels: [], planned: true }));
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [notes, setNotes] = useState(slot.report?.notes ?? "");
  const [adding, setAdding] = useState("");
  const [localError, setLocalError] = useState("");

  function toggle(territoryId: string, label: string) {
    setEntries((current) => current.map((entry) => (entry.territory_id === territoryId ? { ...entry, done_labels: entry.done_labels.includes(label) ? entry.done_labels.filter((item) => item !== label) : [...entry.done_labels, label] } : entry)));
  }

  async function addTerritory(territoryId: string) {
    setAdding("");
    if (!territoryId || entries.some((entry) => entry.territory_id === territoryId)) return;
    const meta = state.territories.find((territory) => territory.id === territoryId);
    try {
      const response = await fetch(`/api/v2/my-outings?territory=${territoryId}`, { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEntries((current) => [...current, { territory_id: territoryId, number: meta?.number ?? "?", name: meta?.name ?? null, labels: body.labels ?? [], prior_done: body.prior_done ?? [], do_not_visit: body.do_not_visit ?? [], done_labels: [], planned: false }]);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo cargar el territorio.");
    }
  }

  const available = state.territories.filter((territory) => !entries.some((entry) => entry.territory_id === territory.id)).map((territory) => ({ value: territory.id, label: `Territorio ${territory.number}` }));

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      {entries.map((entry) => {
        const remaining = entry.labels.filter((label) => !entry.prior_done.includes(label));
        const pending = remaining.filter((label) => !entry.done_labels.includes(label));
        const locked = entry.round_closed && !state.canReportForOthers;
        return (
          <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3" key={entry.territory_id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">Territorio {entry.number}{entry.planned ? "" : " · agregado"}</h4>
              <div className="flex items-center gap-2">
                {remaining.length && !pending.length ? <Pill tone="emerald">Cierra la vuelta</Pill> : <Pill tone="slate">{pending.length} pendiente{pending.length === 1 ? "" : "s"}</Pill>}
                {!entry.planned ? <button aria-label="Quitar territorio" className="text-muted hover:text-rose-300" onClick={() => setEntries((current) => current.filter((item) => item.territory_id !== entry.territory_id))} type="button"><X size={15} /></button> : null}
              </div>
            </div>
            <DoNotVisitWarning items={(entry.do_not_visit ?? []).map((address) => ({ id: `${entry.territory_id}:${address}`, number: entry.number, address }))} />
            {entry.prior_done.length ? <p className="text-xs text-muted">Ya hechas en esta vuelta: {entry.prior_done.join(", ")}</p> : null}
            {remaining.length ? (
              <div className="flex flex-wrap gap-1.5">
                {remaining.map((label) => {
                  const done = entry.done_labels.includes(label);
                  return (
                    <button aria-pressed={done} className={cn("min-h-9 min-w-10 rounded-lg border px-2.5 text-sm font-medium transition", done ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : "border-border text-foreground/80 hover:bg-foreground/[0.05]")} disabled={locked} key={label} onClick={() => toggle(entry.territory_id, label)} type="button">
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted">{entry.labels.length ? "No quedan manzanas pendientes." : "Este territorio no tiene manzanas cargadas."}</p>
            )}
            {locked ? <p className="text-xs text-amber-300">La vuelta ya se cerró: solo quien planifica puede corregirla.</p> : null}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56"><Select onChange={(value) => void addTerritory(value)} options={available} placeholder="+ Agregar otro territorio" size="compact" value={adding} /></div>
        <Plus className="text-muted" size={14} aria-hidden="true" />
      </div>

      <label className="block text-xs text-muted">Observaciones (opcional)
        <textarea className={cn(fieldClass, "mt-1 block min-h-16 w-full")} onChange={(event) => setNotes(event.target.value)} value={notes} />
      </label>
      {localError ? <Notice tone="error">{localError}</Notice> : null}
      <div className="flex gap-2">
        <button className={primarySmallButtonClass} disabled={busy || !entries.length} onClick={async () => { if (await run("submitReport", { slot_id: slot.id, notes: notes || null, entries: entries.map((entry) => ({ territory_id: entry.territory_id, done_labels: entry.done_labels })) })) onCancel(); }} type="button">
          {slot.report ? "Guardar cambios" : "Enviar informe"}
        </button>
        <button className={secondaryButtonClass} onClick={onCancel} type="button">Cancelar</button>
      </div>
    </div>
  );
}

function SlotCard({ slot, state, run, busy }: { slot: Slot; state: State; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const cancelled = slot.status === "CANCELADA";
  return (
    <article className="glass-panel-soft rounded-[1.25rem] p-4 transition" data-entity-id={slot.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{dayLabel(slot.slot_date)} · {slot.hora || "Sin hora"}</p>
          <p className="text-sm text-muted">{slot.lugar || "Sin lugar"}</p>
          {!slot.mine && slot.conductor_name ? <p className="text-xs text-muted">Conductor: {slot.conductor_name}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {cancelled ? <Pill tone="rose">Cancelada</Pill> : slot.report ? <Pill tone="emerald"><CheckCircle2 className="mr-1" size={12} aria-hidden="true" />Informe enviado</Pill> : slot.overdue ? <Pill tone="amber"><TriangleAlert className="mr-1" size={12} aria-hidden="true" />Informe pendiente</Pill> : <Pill tone="sky">Programada</Pill>}
        </div>
      </div>
      <DoNotVisitWarning items={slot.territories.flatMap((territory) => (territory.do_not_visit ?? []).map((address) => ({ id: `${territory.territory_id}:${address}`, number: territory.number, address })))} />
      <p className="mt-2 text-sm text-foreground/90">{slot.territories.length ? slot.territories.map((territory) => `Territorio ${territory.number}`).join(" + ") : "Sin territorios asignados"}</p>
      {slot.report ? <p className="mt-1 text-xs text-muted" data-entity-id={slot.report.id}>{slot.report.on_behalf ? `Cargado por ${slot.report.submitted_by_name ?? "otra persona"}` : "Cargado por el conductor"}{slot.report.entries.length ? ` · ${slot.report.entries.map((entry) => `T${entry.number}: ${entry.done_labels.length} manzana${entry.done_labels.length === 1 ? "" : "s"}`).join(", ")}` : ""}</p> : null}
      {!cancelled && !open ? (
        <button className={cn(miniButtonClass, "mt-3")} onClick={() => setOpen(true)} type="button">{slot.report ? "Editar informe" : "Completar"}</button>
      ) : null}
      {open ? <ReportForm busy={busy} onCancel={() => setOpen(false)} run={run} slot={slot} state={state} /> : null}
    </article>
  );
}

/** Mis salidas: the conductor's assigned outings with the report form preloaded from the plan. */
export function MyOutingsPanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/my-outings");
  const [tab, setTab] = useState<"pending" | "history">("pending");
  useHighlight(Boolean(data));
  if (loading) return <Notice>Cargando tus salidas…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudieron cargar tus salidas."}</Notice>;

  const pending = data.slots.filter((slot) => !slot.report && slot.status === "PROGRAMADA");
  const history = data.slots.filter((slot) => slot.report || slot.status !== "PROGRAMADA").reverse();
  const mine = pending.filter((slot) => slot.mine);
  const others = pending.filter((slot) => !slot.mine);

  return (
    <div className="space-y-4">
      <SubTabs onChange={setTab} tabs={[{ id: "pending", label: `Pendientes${mine.length ? ` (${mine.length})` : ""}` }, { id: "history", label: "Historial" }]} value={tab} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {tab === "pending" ? (
        <>
          {mine.length ? mine.map((slot) => <SlotCard busy={busy} key={slot.id} run={run} slot={slot} state={data} />) : <Empty>No tenés salidas pendientes.</Empty>}
          {data.canReportForOthers && others.length ? (
            <Card title="Informes que faltan de otros conductores" description="Podés cargarlos vos: queda registrado quién los cargó.">
              {others.map((slot) => <SlotCard busy={busy} key={slot.id} run={run} slot={slot} state={data} />)}
            </Card>
          ) : null}
        </>
      ) : history.length ? (
        history.map((slot) => <SlotCard busy={busy} key={slot.id} run={run} slot={slot} state={data} />)
      ) : (
        <Empty>Todavía no hay salidas en tu historial.</Empty>
      )}
    </div>
  );
}
