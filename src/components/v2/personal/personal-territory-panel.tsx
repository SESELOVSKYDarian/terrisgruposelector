"use client";

import { useState } from "react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { formatDateEs } from "@/modules/outings/time";
import { daysBetween, personalModeLabels, personalModes, type PersonalMode } from "@/modules/personal/period";
import { phoneActivities, type PhoneActivity } from "@/modules/telephone/assignment";
import { cn } from "@/lib/utils";
import { BuildingsBrowser } from "../buildings/buildings-browser";
import { DoNotVisitWarning } from "../do-not-visit";
import { useHighlight } from "../highlight";
import { Card, Empty, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type Assignment = { id: string; profile_id: string; person: string | null; territory_id: string; territory_number: number; mode: PersonalMode; assigned_on: string; period_start: string; period_end: string; status: string; auto_renew: boolean };
type Mine = Assignment & { reported_at: string | null; can_report: boolean; do_not_visit: string[]; form: Record<string, unknown> };
type State = {
  assignments: Mine[];
  canManage: boolean;
  manage: { assignments: (Assignment & { last_report: { submitted_at: string; period_end: string } | null })[]; people: { id: string; full_name: string }[]; territories: { id: string; number: number; name: string | null }[] } | null;
};
type Run = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;

const shortLabels: Record<PhoneActivity, string> = { NO_ABONADO: "No abonado", NO_SE_LLAMO: "No se llamó", SE_LLAMO: "Se llamó", NEGOCIO: "Negocio" };
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

function CasaEnCasaForm({ item, run, busy }: { item: Mine; run: Run; busy: boolean }) {
  const labels = (item.form.labels as string[]) ?? [];
  const prior = (item.form.prior_done as string[]) ?? [];
  const remaining = labels.filter((label) => !prior.includes(label));
  const [done, setDone] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Marcá las manzanas que hiciste. Cuenta igual que un informe de salida: alimenta la vuelta del territorio.</p>
      <div className="flex flex-wrap gap-1.5">
        {remaining.map((label) => (
          <button aria-pressed={done.includes(label)} className={cn("min-h-9 min-w-10 rounded-lg border px-2.5 text-sm font-medium transition", done.includes(label) ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : "border-border text-foreground/80 hover:bg-foreground/[0.05]")} key={label} onClick={() => setDone((current) => (current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]))} type="button">{label}</button>
        ))}
        {!remaining.length ? <span className="text-xs text-muted">No quedan manzanas pendientes en la vuelta actual.</span> : null}
      </div>
      <textarea className={cn(fieldClass, "min-h-14 w-full")} onChange={(event) => setNotes(event.target.value)} placeholder="Observaciones (opcional)" value={notes} />
      <button className={primarySmallButtonClass} disabled={busy} onClick={() => void run("submitReport", { assignment_id: item.id, notes: notes || null, done_labels: done })} type="button">Entregar informe</button>
    </div>
  );
}

function TelefonicoForm({ item, run, busy }: { item: Mine; run: Run; busy: boolean }) {
  const numbers = (item.form.numbers as { id: string; number: string; activity: PhoneActivity | null }[]) ?? [];
  const [values, setValues] = useState<Record<string, PhoneActivity>>({});
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Marcá el resultado de los números que llamaste (fecha y conductor son automáticos). Los que no marques quedan como estaban.</p>
      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {numbers.map((entry) => (
          <li className="flex flex-wrap items-center gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5" key={entry.id}>
            <span className="w-36 text-sm font-medium tabular-nums text-foreground">{entry.number}</span>
            <div className="flex flex-wrap gap-1">
              {phoneActivities.map((activity) => (
                <button aria-pressed={values[entry.id] === activity} className={cn("min-h-8 rounded-md border px-2 text-xs font-medium transition", values[entry.id] === activity ? "border-primary bg-primary/20 text-primary" : "border-border text-foreground/70 hover:bg-foreground/[0.05]")} key={activity} onClick={() => setValues((current) => ({ ...current, [entry.id]: activity }))} type="button">{shortLabels[activity]}</button>
              ))}
            </div>
            {entry.activity && !values[entry.id] ? <span className="text-[11px] text-muted">Antes: {shortLabels[entry.activity]}</span> : null}
          </li>
        ))}
      </ul>
      <textarea className={cn(fieldClass, "min-h-14 w-full")} onChange={(event) => setNotes(event.target.value)} placeholder="Observaciones (opcional)" value={notes} />
      <button className={primarySmallButtonClass} disabled={busy} onClick={() => void run("submitReport", { assignment_id: item.id, notes: notes || null, results: Object.entries(values).map(([phone_number_id, activity]) => ({ phone_number_id, activity })) })} type="button">Entregar informe ({Object.keys(values).length} resultados)</button>
    </div>
  );
}

function EdificiosForm({ item, run, busy }: { item: Mine; run: Run; busy: boolean }) {
  const worked = Number(item.form.worked ?? 0);
  const revisits = Number(item.form.revisits ?? 0);
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/90">En este período trabajaste {worked} departamento{worked === 1 ? "" : "s"} ({revisits} revisita{revisits === 1 ? "" : "s"}).</p>
      <BuildingsBrowser territoryId={item.territory_id} />
      <textarea className={cn(fieldClass, "min-h-14 w-full")} onChange={(event) => setNotes(event.target.value)} placeholder="Observaciones (opcional)" value={notes} />
      <button className={primarySmallButtonClass} disabled={busy} onClick={() => void run("submitReport", { assignment_id: item.id, notes: notes || null })} type="button">Entregar informe</button>
    </div>
  );
}

function MyAssignmentCard({ item, run, busy }: { item: Mine; run: Run; busy: boolean }) {
  const left = daysBetween(todayIso(), item.period_end);
  return (
    <article className="glass-panel-soft space-y-3 rounded-[1.25rem] p-4 transition" data-entity-id={item.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Territorio {item.territory_number}</h3>
          <p className="text-xs text-muted">{formatDateEs(item.period_start)} → {formatDateEs(item.period_end)}{left >= 0 ? ` · faltan ${left} día${left === 1 ? "" : "s"}` : ` · atrasado ${-left} día${left === -1 ? "" : "s"}`}</p>
        </div>
        <div className="flex gap-1.5"><Pill tone="sky">{personalModeLabels[item.mode]}</Pill>{item.reported_at ? <Pill tone="emerald">Informe entregado</Pill> : left < 0 ? <Pill tone="rose">Atrasado</Pill> : <Pill tone="amber">Pendiente</Pill>}</div>
      </div>
      <DoNotVisitWarning items={item.do_not_visit.map((address) => ({ id: `${item.id}:${address}`, number: item.territory_number, address }))} />
      {item.reported_at ? <p className="text-sm text-muted">Ya entregaste el informe de este período. El siguiente período empieza el {formatDateEs(item.period_end)}.</p> : item.can_report ? (
        item.mode === "CASA_EN_CASA" ? <CasaEnCasaForm busy={busy} item={item} run={run} /> : item.mode === "TELEFONICO" ? <TelefonicoForm busy={busy} item={item} run={run} /> : <EdificiosForm busy={busy} item={item} run={run} />
      ) : <p className="text-sm text-muted">Vas a poder entregar el informe cuando se acerque el vencimiento ({formatDateEs(item.period_end)}).</p>}
    </article>
  );
}

/** Mi territorio: the person's personal assignments and the report of each one (same logic as its mode's form). */
export function PersonalTerritoryPanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/personal-territories");
  useHighlight(Boolean(data));
  if (loading) return <Notice>Cargando tu territorio…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar tu territorio personal."}</Notice>;
  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data.assignments.length ? data.assignments.map((item) => <MyAssignmentCard busy={busy} item={item} key={item.id} run={run} />) : <Empty>No tenés un territorio personal asignado.</Empty>}
    </div>
  );
}

/** Territorios → Personales: managers assign and follow personal territories. */
export function PersonalAssignmentsManager() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/personal-territories");
  const [person, setPerson] = useState("");
  const [territory, setTerritory] = useState("");
  const [mode, setMode] = useState<PersonalMode>("CASA_EN_CASA");
  const [date, setDate] = useState(todayIso);
  if (loading) return <Notice>Cargando asignaciones…</Notice>;
  if (!data?.manage) return <Notice tone="error">{error || "No tenés permiso para administrar territorios personales."}</Notice>;
  const { manage } = data;

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card title="Asignar territorio personal" description="Cada período dura 3 meses desde la fecha de asignación (15 sep → 15 dic → 15 mar) y se renueva al entregar el informe.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56"><Select onChange={setPerson} options={manage.people.map((entry) => ({ value: entry.id, label: entry.full_name }))} placeholder="Persona" size="compact" value={person} /></div>
          <div className="w-44"><Select onChange={setTerritory} options={manage.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Territorio" size="compact" value={territory} /></div>
          <div className="w-40"><Select onChange={(value) => setMode(value as PersonalMode)} options={personalModes.map((entry) => ({ value: entry, label: personalModeLabels[entry] }))} size="compact" value={mode} /></div>
          <label className="text-xs text-muted">Fecha de asignación<input className={cn(fieldClass, "mt-1 block")} onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
          <button className={primarySmallButtonClass} disabled={busy || !person || !territory || !date} onClick={() => void run("create", { profile_id: person, territory_id: territory, mode, assigned_on: date })} type="button">Asignar</button>
        </div>
      </Card>
      {manage.assignments.length ? (
        <div className="space-y-2">
          {manage.assignments.map((item) => (
            <div className={cn("flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2", item.status !== "ACTIVE" && "opacity-50")} key={item.id}>
              <span className="min-w-40 flex-1 text-sm font-medium text-foreground">{item.person ?? "—"} <span className="text-muted">· Territorio {item.territory_number}</span></span>
              <Pill tone="sky">{personalModeLabels[item.mode]}</Pill>
              <span className="text-xs text-muted">Vence {formatDateEs(item.period_end)}{item.last_report ? ` · último informe ${new Date(item.last_report.submitted_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : ""}</span>
              {item.status === "ACTIVE" ? <button className={miniButtonClass} disabled={busy} onClick={() => void run("end", { id: item.id })} type="button">Finalizar</button> : <Pill tone="slate">Finalizada</Pill>}
            </div>
          ))}
        </div>
      ) : (
        <Empty>Todavía no hay territorios personales asignados.</Empty>
      )}
    </div>
  );
}
