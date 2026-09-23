"use client";

import { useState } from "react";
import { Select } from "@/app/_components/select";
import { primarySmallButtonClass } from "@/app/_components/ui-classes";
import { lockUnitLabels, type LockDuration } from "@/modules/buildings/activity";
import { cn } from "@/lib/utils";
import { Card, Notice, Pill, fieldClass } from "../ui";
import { useModuleApi } from "../use-module-api";

type State = { canEditLock: boolean; lock: LockDuration | null; integrations: { push: boolean; googleCredentials: boolean; googleWrites: boolean; cron: boolean; email: boolean } };

function LockCard({ lock, canEdit }: { lock: LockDuration; canEdit: boolean }) {
  const [amount, setAmount] = useState(String(lock.amount));
  const [unit, setUnit] = useState<LockDuration["unit"]>(lock.unit);
  const [message, setMessage] = useState("");
  async function save() {
    const response = await fetch("/api/v2/buildings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setLockDuration", payload: { amount: Number(amount), unit } }) });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Guardado." : body.error ?? "No se pudo guardar.");
  }
  return (
    <Card title="Tiempo de bloqueo de edificios" description="Cuánto queda bloqueado un departamento trabajado sin interés o sin atender.">
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-muted">Cantidad<input className={cn(fieldClass, "mt-1 block w-24")} inputMode="numeric" onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} value={amount} /></label>
          <div className="w-40"><Select onChange={(value) => setUnit(value as LockDuration["unit"])} options={(Object.keys(lockUnitLabels) as LockDuration["unit"][]).map((key) => ({ value: key, label: lockUnitLabels[key] }))} size="compact" value={unit} /></div>
          <button className={primarySmallButtonClass} disabled={!amount} onClick={() => void save()} type="button">Guardar</button>
          {message ? <span className="text-sm text-muted">{message}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-foreground/90">{lock.amount} {lockUnitLabels[lock.unit]}. Lo define el Superintendente de Servicio o el Siervo de Territorios.</p>
      )}
    </Card>
  );
}

function TestEmailCard() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; transport: string; error?: string } | null>(null);
  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/v2/system", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sendTestEmail", payload: { to } }) });
      const body = await response.json().catch(() => ({}));
      setResult(response.ok ? body : { sent: false, transport: "?", error: body.error ?? "No se pudo enviar." });
    } catch {
      setResult({ sent: false, transport: "?", error: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Correo de prueba" description="Manda un mail real ahora mismo y te muestra el error exacto si falla (SMTP o Resend), acá sí es seguro verlo.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm text-muted">Mandar a<input className={cn(fieldClass, "mt-1 block w-full")} onChange={(event) => setTo(event.target.value)} placeholder="tu@correo.com" type="email" value={to} /></label>
        <button className={primarySmallButtonClass} disabled={busy || !to} onClick={() => void send()} type="button">{busy ? "Enviando…" : "Enviar prueba"}</button>
      </div>
      {result ? (
        <Notice tone={result.sent ? "success" : "error"}>
          {result.sent ? `Enviado por ${result.transport}. Revisá la casilla (y spam).` : `Falló por ${result.transport}: ${result.error}`}
        </Notice>
      ) : null}
    </Card>
  );
}

const reminderRules = [
  "Salida asignada: aviso inmediato al conductor.",
  "Fin de semana: aviso 3 días antes al conductor.",
  "Informe de salida: recordatorio 3 horas después de la hora programada si falta.",
  "Salida por Grupo: una semana antes y luego 24 h, 6 h y 2 h antes del cierre (se recalcula con las prórrogas).",
  "Territorio personal: una semana antes, el día del vencimiento y 3 días después.",
  "Notificaciones internas: se eliminan automáticamente a los 30 días.",
];

/** Ajustes del sistema: operational parameters and integration health (secrets are never shown). */
export function SystemSettings() {
  const { data, error, loading } = useModuleApi<State>("/api/v2/system");
  if (loading) return <Notice>Cargando ajustes…</Notice>;
  if (!data) return <Notice tone="error">{error || "No se pudieron cargar los ajustes."}</Notice>;
  const { integrations } = data;
  const rows: { label: string; ok: boolean; hint: string }[] = [
    { label: "Avisos push", ok: integrations.push, hint: "Claves VAPID" },
    { label: "Recordatorios automáticos", ok: integrations.cron, hint: "CRON_SECRET + un cron que llame a /api/cron/reminders" },
    { label: "Correo (registro y OTP)", ok: integrations.email, hint: "SMTP_HOST/SMTP_USER/SMTP_PASSWORD, o RESEND_API_KEY" },
    { label: "Google Docs · credenciales", ok: integrations.googleCredentials, hint: "Cuenta de servicio" },
    { label: "Google Docs · escritura", ok: integrations.googleWrites, hint: "S13_GOOGLE_WRITE_ENABLED (apagada por defecto)" },
  ];
  return (
    <div className="space-y-4">
      {data.lock ? <LockCard canEdit={data.canEditLock} lock={data.lock} /> : null}
      <Card title="Recordatorios automáticos" description="Reglas fijas del sistema; las fechas límite se leen de cada ventana o período, así que las prórrogas se respetan.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">{reminderRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </Card>
      <Card title="Integraciones" description="Solo se indica si están configuradas; nunca se muestran claves.">
        <div className="space-y-2">
          {rows.map((row) => (
            <div className="flex flex-wrap items-center gap-2" key={row.label}>
              <span className="min-w-56 flex-1 text-sm text-foreground">{row.label}</span>
              {row.ok ? <Pill tone="emerald">Configurado</Pill> : <Pill tone="slate">Pendiente</Pill>}
              <span className="text-xs text-muted">{row.hint}</span>
            </div>
          ))}
        </div>
      </Card>
      <TestEmailCard />
    </div>
  );
}
