"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Select } from "@/app/_components/select";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { phoneActivityLabels, type PhoneActivity } from "@/modules/telephone/assignment";
import { formatS13Date } from "@/modules/s13/layout";
import { cn } from "@/lib/utils";
import { Card, Empty, Notice, Pill } from "../ui";
import { useModuleApi } from "../use-module-api";

type NumberRow = { id: string; territory_id: string; number: string; active: boolean; activity: PhoneActivity | null; last_activity_on: string | null; conductor: string | null };
type State = { territories: { id: string; number: number; name: string | null }[]; numbers: NumberRow[] };

/** Territorios → Telefónico: the phone numbers of each territory (same territories, not a separate map). */
export function TelephonePanel() {
  const { data, error, loading, busy, run } = useModuleApi<State>("/api/v2/telephone");
  const [filter, setFilter] = useState("");
  const [territory, setTerritory] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState("");
  const numberOf = useMemo(() => new Map((data?.territories ?? []).map((entry) => [entry.id, entry.number])), [data]);
  if (loading) return <Notice>Cargando teléfonos…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudo cargar el territorio telefónico."}</Notice>;

  const rows = data.numbers.filter((row) => !filter || row.territory_id === filter).sort((a, b) => (numberOf.get(a.territory_id) ?? 0) - (numberOf.get(b.territory_id) ?? 0) || a.number.localeCompare(b.number));

  async function add() {
    const before = data?.numbers.length ?? 0;
    if (await run("addNumbers", { territory_id: territory, text })) {
      setText("");
      setReport(`Números agregados. Los repetidos o inválidos se omiten automáticamente (antes había ${before}).`);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card title="Agregar números" description="Pegá uno por línea. Se ignoran los repetidos (aunque cambie el formato) y los que no parezcan un teléfono.">
        <div className="space-y-2">
          <div className="w-56"><Select onChange={setTerritory} options={data.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))} placeholder="Territorio" size="compact" value={territory} /></div>
          <textarea className="min-h-24 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary/60" onChange={(event) => setText(event.target.value)} placeholder={"11 4444-5555\n11 4444-5556"} value={text} />
          <button className={primarySmallButtonClass} disabled={busy || !territory || !text.trim()} onClick={() => void add()} type="button">Agregar</button>
          {report ? <p className="text-sm text-muted">{report}</p> : null}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56"><Select onChange={setFilter} options={[{ value: "", label: "Todos los territorios" }, ...data.territories.map((entry) => ({ value: entry.id, label: `Territorio ${entry.number}` }))]} size="compact" value={filter} /></div>
        <span className="text-sm text-muted">{rows.length} número{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.1em] text-muted"><tr>{["Territorio", "Número", "Conductor", "Últ. fecha", "Actividad", ""].map((header) => <th className="px-3 py-2 font-semibold" key={header}>{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr className={cn(!row.active && "opacity-50")} key={row.id}>
                  <td className="px-3 py-2">{numberOf.get(row.territory_id) ?? "?"}</td>
                  <td className="px-3 py-2 tabular-nums">{row.number}</td>
                  <td className="px-3 py-2">{row.conductor ?? "—"}</td>
                  <td className="px-3 py-2">{formatS13Date(row.last_activity_on) || "—"}</td>
                  <td className="px-3 py-2">{row.activity ? <Pill tone={row.activity === "SE_LLAMO" ? "emerald" : row.activity === "NO_ABONADO" ? "rose" : row.activity === "NEGOCIO" ? "sky" : "slate"}>{phoneActivityLabels[row.activity]}</Pill> : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className={miniButtonClass} disabled={busy} onClick={() => void run("setActive", { id: row.id, active: !row.active })} type="button">{row.active ? "Desactivar" : "Activar"}</button>
                      <button aria-label="Eliminar número" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:text-rose-300" disabled={busy} onClick={() => void run("delete", { id: row.id })} type="button"><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Todavía no hay números cargados.</Empty>
      )}
    </div>
  );
}
