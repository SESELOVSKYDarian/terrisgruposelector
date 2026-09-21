"use client";

import { useState } from "react";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { phoneActivities, phoneActivityLabels, type PhoneActivity } from "@/modules/telephone/assignment";
import { cn } from "@/lib/utils";
import { Notice, Pill, fieldClass } from "../ui";

export type PhoneBlock = {
  assignment_id: string;
  total: number;
  done: number;
  called_on: string | null;
  numbers: { phone_number_id: string; number: string; territory_number: number | string; activity: PhoneActivity | null; previous_activity: PhoneActivity | null; last_activity_on: string | null }[];
};

const shortLabels: Record<PhoneActivity, string> = { NO_ABONADO: "No abonado", NO_SE_LLAMO: "No se llamó", SE_LLAMO: "Se llamó", NEGOCIO: "Negocio" };
const activeStyles: Record<PhoneActivity, string> = {
  NO_ABONADO: "border-rose-400/50 bg-rose-500/20 text-rose-100",
  NO_SE_LLAMO: "border-slate-400/50 bg-slate-500/20 text-slate-100",
  SE_LLAMO: "border-emerald-400/50 bg-emerald-500/20 text-emerald-100",
  NEGOCIO: "border-sky-400/50 bg-sky-500/20 text-sky-100",
};

/**
 * Fast entry for a Zoom outing: one row per assigned number with four one-tap results, plus
 * "mark all pending as X" so 30 numbers never mean 30 modals. The conductor and date are automatic.
 */
export function PhoneResults({ slotId, slotDate, phone, run, busy }: { slotId: string; slotDate: string; phone: PhoneBlock; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [values, setValues] = useState<Record<string, PhoneActivity | null>>(() => Object.fromEntries(phone.numbers.map((entry) => [entry.phone_number_id, entry.activity])));
  const [calledOn, setCalledOn] = useState(phone.called_on ?? slotDate);
  const pending = phone.numbers.filter((entry) => !values[entry.phone_number_id]);
  const changed = phone.numbers.filter((entry) => values[entry.phone_number_id] && values[entry.phone_number_id] !== entry.activity);

  if (!phone.numbers.length) return <Notice tone="warning">Esta salida no tiene números asignados: no hay teléfonos cargados en los territorios elegidos.</Notice>;

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Resultados telefónicos</p>
        {pending.length ? <Pill tone="amber">{pending.length} sin resultado</Pill> : <Pill tone="emerald">Completo</Pill>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">Fecha
          <input className={cn(fieldClass, "ml-2")} onChange={(event) => setCalledOn(event.target.value)} type="date" value={calledOn} />
        </label>
        {pending.length ? phoneActivities.map((activity) => (
          <button className={miniButtonClass} key={activity} onClick={() => setValues((current) => ({ ...current, ...Object.fromEntries(pending.map((entry) => [entry.phone_number_id, activity])) }))} type="button">Pendientes: {shortLabels[activity]}</button>
        )) : null}
      </div>
      <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
        {phone.numbers.map((entry) => (
          <li className="flex flex-wrap items-center gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5" key={entry.phone_number_id}>
            <span className="w-36 text-sm font-medium tabular-nums text-foreground">{entry.number}</span>
            <span className="w-12 text-xs text-muted">T{entry.territory_number}</span>
            <div className="flex flex-wrap gap-1">
              {phoneActivities.map((activity) => (
                <button aria-pressed={values[entry.phone_number_id] === activity} className={cn("min-h-8 rounded-md border px-2 text-xs font-medium transition", values[entry.phone_number_id] === activity ? activeStyles[activity] : "border-border text-foreground/70 hover:bg-foreground/[0.05]")} key={activity} onClick={() => setValues((current) => ({ ...current, [entry.phone_number_id]: activity }))} title={phoneActivityLabels[activity]} type="button">
                  {shortLabels[activity]}
                </button>
              ))}
            </div>
            {entry.previous_activity && !entry.activity ? <span className="text-[11px] text-muted">Antes: {shortLabels[entry.previous_activity]}</span> : null}
          </li>
        ))}
      </ul>
      <button className={primarySmallButtonClass} disabled={busy || !changed.length} onClick={() => void run("saveCallResults", { slot_id: slotId, called_on: calledOn, results: changed.map((entry) => ({ phone_number_id: entry.phone_number_id, activity: values[entry.phone_number_id] })) })} type="button">
        Guardar resultados ({changed.length})
      </button>
    </div>
  );
}
