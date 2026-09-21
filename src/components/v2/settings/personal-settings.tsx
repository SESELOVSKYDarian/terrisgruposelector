"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/app/_components/theme-toggle";
import { miniButtonClass, primarySmallButtonClass } from "@/app/_components/ui-classes";
import { pushSupported, subscribeThisDevice, thisDeviceId, type SubscribeResult } from "@/components/push/subscribe";
import { Card, Empty, Notice, Pill } from "../ui";

type Device = { device_id: string; device_name: string; enabled: boolean; updated_at: string };
type Person = { full_name: string; username: string; email: string | null; roles: string[] };

const shortcuts = [
  { keys: "Ctrl + K  (⌘ + K en Mac)", action: "Abrir el buscador y los comandos" },
  { keys: "↑ ↓", action: "Moverte entre los resultados" },
  { keys: "Enter", action: "Abrir el resultado elegido" },
  { keys: "Esc", action: "Cerrar el buscador o un panel" },
];

const messages: Record<SubscribeResult, string> = {
  ok: "Listo: este dispositivo ya recibe avisos.",
  denied: "El navegador bloqueó los avisos. Podés habilitarlos desde la configuración del sitio.",
  unconfigured: "Los avisos push todavía no están configurados en este servidor. Tus notificaciones internas siguen funcionando.",
  unsupported: "Este navegador no admite avisos push. Tus notificaciones internas siguen funcionando.",
  error: "No se pudo activar ahora. Probá de nuevo más tarde.",
};

function Notifications() {
  const [permission, setPermission] = useState<string>("desconocido");
  const [result, setResult] = useState<SubscribeResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Notification.permission only exists in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser API
    setPermission(pushSupported() ? Notification.permission : "no compatible");
  }, []);
  const labels: Record<string, string> = { granted: "Permitidos", denied: "Bloqueados", default: "Sin decidir", "no compatible": "No compatible" };
  return (
    <div className="space-y-3">
      <Card title="Avisos en este dispositivo" description="El navegador solo te pide permiso cuando tocás el botón. Las notificaciones internas (campanita) funcionan siempre, con o sin avisos push.">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={permission === "granted" ? "emerald" : permission === "denied" ? "rose" : "slate"}>{labels[permission] ?? permission}</Pill>
          <button className={primarySmallButtonClass} disabled={busy || permission === "granted" || permission === "no compatible"} onClick={async () => { setBusy(true); const outcome = await subscribeThisDevice(); setResult(outcome); if (pushSupported()) setPermission(Notification.permission); setBusy(false); }} type="button">Activar avisos</button>
        </div>
        {result ? <Notice tone={result === "ok" ? "success" : "warning"}>{messages[result]}</Notice> : null}
      </Card>
    </div>
  );
}

function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/push-subscriptions", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDevices(body.devices ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus dispositivos.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the person's devices
    void load();
    setCurrent(thisDeviceId());
  }, []);

  async function disable(deviceId: string) {
    await fetch("/api/push-subscriptions", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) });
    await load();
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!devices) return <Notice>Cargando dispositivos…</Notice>;
  return devices.length ? (
    <div className="space-y-2">
      {devices.map((device) => (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2" key={device.device_id}>
          <span className="min-w-40 flex-1 text-sm font-medium text-foreground">{device.device_name}{device.device_id === current ? " (este dispositivo)" : ""}</span>
          {device.enabled ? <Pill tone="emerald">Con avisos</Pill> : <Pill tone="slate">Desactivado</Pill>}
          {device.enabled ? <button className={miniButtonClass} onClick={() => void disable(device.device_id)} type="button">Desactivar</button> : null}
        </div>
      ))}
    </div>
  ) : (
    <Empty>Todavía no activaste avisos en ningún dispositivo.</Empty>
  );
}

/** Ajustes personales (from the profile menu). Not the system settings: those live under Ajustes. */
export function PersonalSettings({ view, person }: { view: string; person: Person }) {
  if (view === "appearance") return <Card title="Apariencia" description="Elegí el tema claro u oscuro. Se recuerda en este navegador."><ThemeToggle /></Card>;
  if (view === "notifications") return <Notifications />;
  if (view === "devices") return <Card title="Dispositivos" description="Navegadores y celulares donde recibís avisos push."><Devices /></Card>;
  if (view === "shortcuts") {
    return (
      <Card title="Atajos de teclado">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-border/60">
            {shortcuts.map((entry) => <tr key={entry.keys}><td className="py-2 pr-4 font-mono text-xs text-foreground">{entry.keys}</td><td className="py-2 text-muted">{entry.action}</td></tr>)}
          </tbody>
        </table>
      </Card>
    );
  }
  return (
    <Card title="Mi cuenta" description="Estos datos los administra el Coordinador.">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Nombre</dt><dd className="text-foreground">{person.full_name}</dd>
        <dt className="text-muted">Usuario</dt><dd className="text-foreground">{person.username}</dd>
        <dt className="text-muted">Correo</dt><dd className="text-foreground">{person.email ?? "—"}</dd>
        <dt className="text-muted">Roles</dt><dd className="text-foreground">{person.roles.join(", ") || "—"}</dd>
      </dl>
    </Card>
  );
}
