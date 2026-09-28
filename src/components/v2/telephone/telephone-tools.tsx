"use client";

import { useState } from "react";
import { primarySmallButtonClass } from "@/app/_components/ui-classes";
import { cn } from "@/lib/utils";
import { Card, Notice, fieldClass } from "../ui";

async function post(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/v2/telephone", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "No se pudo completar la acción.");
  return body;
}

const weekdays = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
  { id: 7, label: "Dom" },
];

/** Weekdays whose outing is Zoom by default: "Autocompletar semana" gives them the phone list of the most behind territories. */
export function ZoomDaysCard({ initial, onChanged }: { initial: { days: number[]; hora: string | null }; onChanged: () => void }) {
  const [days, setDays] = useState<number[]>(initial.days);
  const [hora, setHora] = useState(initial.hora ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await post("setZoomDays", { days, hora: hora.trim() || null });
      setMessage({ tone: "success", text: "Guardado. Se aplica al autocompletar cada semana." });
      onChanged();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Error inesperado." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Salidas por Zoom predefinidas" description="Los días marcados, al autocompletar la semana, la salida queda por Zoom con el listado de teléfonos: primero el territorio con la última actividad más vieja, y se suman territorios completos hasta llegar a 20 números.">
      <div className="space-y-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          {weekdays.map((day) => {
            const on = days.includes(day.id);
            return (
              <button
                aria-pressed={on}
                className={cn("min-h-9 min-w-12 cursor-pointer rounded-lg border px-3 text-sm font-medium transition", on ? "border-sky-400/60 bg-sky-400/15 text-sky-300" : "border-border text-muted hover:text-foreground")}
                key={day.id}
                onClick={() => setDays((current) => (on ? current.filter((id) => id !== day.id) : [...current, day.id].sort()))}
                type="button"
              >
                {day.label}
              </button>
            );
          })}
          <input aria-label="Hora" className={cn(fieldClass, "w-28")} onChange={(event) => setHora(event.target.value)} placeholder="Hora (19:00)" value={hora} />
          <button className={primarySmallButtonClass} disabled={busy} onClick={() => void save()} type="button">Guardar</button>
        </div>
      </div>
    </Card>
  );
}

type ImportResult = { created: number; updated: number; invalid: number; unknown_territories: number[] };

/** Bulk load of the phone history (last caller, date and result per number) pasted straight from the spreadsheet. */
export function HistoryImportCard({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function send() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult((await post("importHistory", { text })) as ImportResult);
      setText("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Importar historial de la planilla" description="Pegá las filas tal cual: Territorio, Teléfono, Apellido y Nombre de quien llamó, Fecha (d/m/aaaa) y Resultado. Los teléfonos nuevos se crean; los existentes se actualizan solo si la fecha es más reciente. Fecha, conductor y resultado pueden faltar.">
      <div className="space-y-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {result ? (
          <Notice tone="success">
            {result.created} nuevo{result.created === 1 ? "" : "s"}, {result.updated} actualizado{result.updated === 1 ? "" : "s"}, {result.invalid} línea{result.invalid === 1 ? "" : "s"} inválida{result.invalid === 1 ? "" : "s"}
            {result.unknown_territories.length ? `; territorios inexistentes: ${result.unknown_territories.join(", ")}` : ""}.
          </Notice>
        ) : null}
        <textarea className="min-h-32 w-full rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/60" onChange={(event) => setText(event.target.value)} placeholder={"1\t11 4444-5555\tPérez, Juan\t12/09/2026\tSe llamó"} value={text} />
        <button className={primarySmallButtonClass} disabled={busy || !text.trim()} onClick={() => void send()} type="button">Importar</button>
      </div>
    </Card>
  );
}
