"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { completedByLabel, formatDeadlineEs, windowServiceDates } from "@/modules/groups/group-outings";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type Person = { id: string; full_name: string };
type Group = { id: string; name: string; responsibles: Person[]; conductors: { id: string; full_name: string }[] };
type Window = { id: string; name: string; saturday_date: string | null; sunday_date: string | null; booking_deadline: string; open: boolean };
type Response = { id: string; reservation_window_id: string; group_id: string; service_date: string; lugar: string; hora: string | null; conductor_id: string | null; completed_by: string | null; territory_ids: string[] };
type State = {
  me: string;
  isPlanner: boolean;
  windows: Window[];
  groups: Group[];
  responses: Response[];
  territories: { id: string; number: string | number; name: string | null }[];
  taken: { territory_id: string; service_date: string; group_id: string | null }[];
};
type Run = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;

const dayNames = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const dateLabel = (date: string) => `${dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;

function nextSaturday() {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + ((6 - base.getUTCDay() + 7) % 7 || 7));
  return base.toISOString().slice(0, 10);
}

function twoDaysBefore(date: string, time = "21:00") {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 2);
  return `${base.toISOString().slice(0, 10)}T${time}`;
}

function OpenWindowCard({ run, busy }: { run: Run; busy: boolean }) {
  const [saturday, setSaturday] = useState(nextSaturday);
  const [days, setDays] = useState<"SATURDAY" | "SUNDAY" | "BOTH">("BOTH");
  const [deadline, setDeadline] = useState(() => twoDaysBefore(nextSaturday()));
  return (
    <Card title="Abrir Salida por Grupo" description="Crea la ventana para todos los grupos y avisa al Superintendente y al Auxiliar de cada uno.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-muted">Sábado del fin de semana
          <input className={cn(fieldClass, "mt-1 block")} onChange={(event) => { setSaturday(event.target.value); setDeadline(twoDaysBefore(event.target.value)); }} type="date" value={saturday} />
        </label>
        <div className="text-sm text-muted">Días
          <div className="mt-1 flex gap-1">
            {(["SATURDAY", "SUNDAY", "BOTH"] as const).map((option) => (
              <button aria-pressed={days === option} className={cn(miniButtonClass, days === option && "bg-primary/20 text-primary")} key={option} onClick={() => setDays(option)} type="button">
                {option === "SATURDAY" ? "Sábado" : option === "SUNDAY" ? "Domingo" : "Ambos"}
              </button>
            ))}
          </div>
        </div>
        <label className="text-sm text-muted">Fecha límite (hora de Argentina)
          <input className={cn(fieldClass, "mt-1 block")} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" value={deadline} />
        </label>
        <button className={primarySmallButtonClass} disabled={busy || !saturday || !deadline} onClick={() => void run("openWindow", { saturday_date: saturday, days, deadline_local: deadline })} type="button">Abrir ventana</button>
      </div>
    </Card>
  );
}

function ResponseForm({ window, date, group, response, state, run, busy, disabled }: { window: Window; date: string; group: Group; response: Response | undefined; state: State; run: Run; busy: boolean; disabled: boolean }) {
  const [lugar, setLugar] = useState(response?.lugar ?? "");
  const [hora, setHora] = useState(response?.hora ?? "");
  const [conductor, setConductor] = useState(response?.conductor_id ?? "");
  const [territories, setTerritories] = useState<string[]>(response?.territory_ids ?? []);
  const takenByOthers = useMemo(() => new Set(state.taken.filter((row) => row.service_date === date).map((row) => row.territory_id)), [state.taken, date]);
  const label = completedByLabel(response ?? null, group.responsibles, state.me);

  return (
    <div className="space-y-3 rounded-xl bg-foreground/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{dateLabel(date)}</h4>
        {label ? <Pill tone="emerald"><CheckCircle2 className="mr-1" size={12} aria-hidden="true" />{label}</Pill> : <Pill tone="amber">Pendiente</Pill>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
        <label className="text-xs text-muted">Lugar de salida (obligatorio)
          <input className={cn(fieldClass, "mt-1 w-full")} disabled={disabled} onChange={(event) => setLugar(event.target.value)} placeholder="Ej. Paso 123" value={lugar} />
        </label>
        <label className="text-xs text-muted">Hora
          <input className={cn(fieldClass, "mt-1 w-full")} disabled={disabled} onChange={(event) => setHora(event.target.value)} type="time" value={hora} />
        </label>
      </div>
      <div>
        <p className="mb-1 text-xs text-muted">Conductor del grupo</p>
        <Select onChange={setConductor} options={[{ value: "", label: "Sin conductor" }, ...group.conductors.map((person) => ({ value: person.id, label: person.full_name }))]} size="compact" value={conductor} />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted">Territorios</p>
        <div className="flex flex-wrap gap-1.5">
          {state.territories.map((territory) => {
            const selected = territories.includes(territory.id);
            const blocked = takenByOthers.has(territory.id) && !selected && !response?.territory_ids.includes(territory.id);
            return (
              <button
                aria-pressed={selected}
                className={cn("min-h-8 min-w-9 rounded-lg border px-2 text-xs font-medium transition", selected ? "border-primary bg-primary/20 text-primary" : "border-border text-foreground/80 hover:bg-foreground/[0.05]", blocked && "cursor-not-allowed opacity-35")}
                disabled={disabled || blocked}
                key={territory.id}
                onClick={() => setTerritories((current) => (current.includes(territory.id) ? current.filter((id) => id !== territory.id) : [...current, territory.id]))}
                title={blocked ? "Reservado por otro grupo" : `Territorio ${territory.number}`}
                type="button"
              >
                {territory.number}
              </button>
            );
          })}
        </div>
      </div>
      {disabled ? (
        <p className="text-xs text-muted">{window.open ? "Solo lectura." : "La fecha límite ya pasó: pedí una prórroga."}</p>
      ) : (
        <button className={primarySmallButtonClass} disabled={busy || !lugar.trim()} onClick={() => void run("saveResponse", { window_id: window.id, group_id: group.id, service_date: date, lugar, hora: hora || null, conductor_id: conductor || null, territory_ids: territories })} type="button">
          {response ? "Guardar cambios" : "Completar"}
        </button>
      )}
    </div>
  );
}

function WindowCard({ window, state, run, busy }: { window: Window; state: State; run: Run; busy: boolean }) {
  const dates = windowServiceDates(window);
  const [extendTo, setExtendTo] = useState("");
  return (
    <Card
      title={window.name}
      description={`Cierra el ${formatDeadlineEs(window.booking_deadline)}`}
      action={window.open ? <Pill tone="emerald">Abierta</Pill> : <Pill tone="rose">Cerrada</Pill>}
    >
      {state.isPlanner ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 p-3">
          <label className="text-xs text-muted">Prórroga (hora de Argentina)
            <input className={cn(fieldClass, "mt-1 block")} onChange={(event) => setExtendTo(event.target.value)} type="datetime-local" value={extendTo} />
          </label>
          <button className={miniButtonClass} disabled={busy || !extendTo} onClick={() => void run("extendDeadline", { window_id: window.id, deadline_local: extendTo }).then((done) => done && setExtendTo(""))} type="button">
            <CalendarClock size={14} aria-hidden="true" />Extender plazo
          </button>
        </div>
      ) : null}
      {state.groups.length ? (
        state.groups.map((group) => {
          const responses = state.responses.filter((response) => response.reservation_window_id === window.id && response.group_id === group.id);
          const complete = dates.every((date) => responses.some((response) => response.service_date === date));
          return (
            <details className="rounded-xl border border-border/60" key={group.id} open={!state.isPlanner}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground">
                <span>{group.name}</span>
                {complete ? <Pill tone="emerald">Completo</Pill> : <Pill tone="amber"><Clock className="mr-1" size={12} aria-hidden="true" />Pendiente</Pill>}
              </summary>
              <div className="grid gap-3 p-3 lg:grid-cols-2">
                {dates.map((date) => {
                  const response = responses.find((item) => item.service_date === date);
                  return <ResponseForm busy={busy} disabled={!window.open} date={date} group={group} key={`${date}:${response?.id ?? "new"}:${response?.completed_by ?? ""}`} response={response} run={run} state={state} window={window} />;
                })}
              </div>
            </details>
          );
        })
      ) : (
        <Empty>No sos responsable de ningún grupo.</Empty>
      )}
    </Card>
  );
}

/** Reservas → Salida por grupo: groups answer here and the answer feeds the planning automatically. */
export function GroupOutingsPanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/group-outings");
  if (loading) return <Notice>Cargando salidas por grupo…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar la información."}</Notice>;
  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data.isPlanner ? <OpenWindowCard busy={busy} run={run} /> : null}
      {data.windows.length ? data.windows.map((window) => <WindowCard busy={busy} key={window.id} run={run} state={data} window={window} />) : <Empty>No hay ventanas de Salida por Grupo abiertas.</Empty>}
    </div>
  );
}
