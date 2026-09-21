"use client";

import { useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { isoWeekdayNames } from "@/modules/outings/recurring";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type TemplateRow = { id: string; isodow: number; hora: string; lugar: string | null; default_conductor_id: string | null; conductor_name: string | null; active: boolean };
type State = { slots: TemplateRow[]; conductors: { id: string; full_name: string }[] };
export type PlanningWeek = { id: string; starts_on: string; status?: string };

const displayOrder = [1, 2, 3, 4, 5, 6, 7];

function TemplateRowEditor({ row, conductors, run }: { row: TemplateRow; conductors: State["conductors"]; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean> }) {
  const [hora, setHora] = useState(row.hora);
  const [lugar, setLugar] = useState(row.lugar ?? "");
  const starred = Boolean(row.default_conductor_id);
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2", !row.active && "opacity-50")}>
      <input aria-label="Hora" className={cn(fieldClass, "w-[92px]")} onBlur={() => hora && hora !== row.hora && void run("update", { id: row.id, hora })} onChange={(event) => setHora(event.target.value)} type="time" value={hora} />
      <div className="w-52">
        <Select
          onChange={(value) => void run("update", { id: row.id, default_conductor_id: value || null })}
          options={[{ value: "", label: "Sin conductor fijo" }, ...conductors.map((conductor) => ({ value: conductor.id, label: conductor.full_name }))]}
          placeholder="Conductor"
          size="compact"
          value={row.default_conductor_id ?? ""}
        />
      </div>
      <span className={cn("inline-flex items-center gap-1 text-xs", starred ? "text-amber-300" : "text-muted")} title="Conductor semanal predeterminado">
        <Star fill={starred ? "currentColor" : "none"} size={14} aria-hidden="true" />
        {starred ? "Predeterminado" : "Sin estrella"}
      </span>
      <input aria-label="Lugar" className={cn(fieldClass, "min-w-40 flex-1")} onBlur={() => lugar !== (row.lugar ?? "") && void run("update", { id: row.id, lugar: lugar || null })} onChange={(event) => setLugar(event.target.value)} placeholder="Lugar (opcional)" value={lugar} />
      <button className={miniButtonClass} onClick={() => void run("update", { id: row.id, active: !row.active })} type="button">{row.active ? "Pausar" : "Activar"}</button>
      <button aria-label="Eliminar fila" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:text-rose-300" onClick={() => void run("delete", { id: row.id })} type="button">
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Salidas → Conductores → Semanales: the fixed weekly calendar with a starred default conductor per row. */
export function RecurringConductorsPanel({ weeks }: { weeks: PlanningWeek[] }) {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/recurring-outings");
  const [weekId, setWeekId] = useState("");
  const [applied, setApplied] = useState<number | null>(null);

  if (loading) return <Notice>Cargando plantilla semanal…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar la plantilla semanal."}</Notice>;

  async function applyToWeek() {
    if (!weekId) return;
    setApplied(null);
    const before = data?.slots.length ?? 0;
    if (await run("applyToWeek", { weekly_outing_id: weekId })) setApplied(before);
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card title="Calendario semanal fijo" description="La estrella es el conductor semanal predeterminado: se conserva semana a semana hasta que lo cambies. Ajustar una semana puntual no modifica esta plantilla.">
        <div className="space-y-4">
          {displayOrder.map((isodow) => {
            const rows = data.slots.filter((slot) => slot.isodow === isodow);
            return (
              <div className="space-y-2" key={isodow}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{isoWeekdayNames[isodow]}</h3>
                  <button className={miniButtonClass} disabled={busy} onClick={() => void run("create", { isodow, hora: "18:00" })} type="button">
                    <Plus size={14} aria-hidden="true" />Agregar horario
                  </button>
                </div>
                {rows.length ? rows.map((row) => <TemplateRowEditor conductors={data.conductors} key={`${row.id}:${row.hora}:${row.lugar}`} row={row} run={run} />) : <p className="px-1 text-xs text-muted">Sin salida.</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Aplicar a una semana" description="Las semanas nuevas se generan solas desde esta plantilla. Usá esto para completar una semana que ya existía; no duplica filas ni pisa tus ajustes.">
        {weeks.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select onChange={setWeekId} options={weeks.map((week) => ({ value: week.id, label: `Semana del ${week.starts_on.split("-").reverse().join("/")}` }))} placeholder="Elegí una semana" value={weekId} />
            </div>
            <button className={primarySmallButtonClass} disabled={!weekId || busy} onClick={() => void applyToWeek()} type="button">Aplicar plantilla</button>
            {applied !== null ? <span className="text-sm text-muted">Plantilla aplicada.</span> : null}
          </div>
        ) : (
          <Empty>Todavía no hay semanas creadas.</Empty>
        )}
      </Card>
    </div>
  );
}
