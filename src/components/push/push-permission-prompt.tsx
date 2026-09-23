"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { pushSupported, subscribeMessages, subscribeThisDevice } from "./subscribe";

/** Post-login offer to turn on push notifications: a small card in the bottom-right corner. */
export function PushPermissionPrompt({ userId }: { userId: string }) {
  const dismissedKey = `pr-territorios-push-dismissed:${userId}`;
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!pushSupported()) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const timer = window.setTimeout(() => {
      if (Notification.permission === "default" && !localStorage.getItem(dismissedKey)) setVisible(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dismissedKey]);

  const dismiss = () => {
    localStorage.setItem(dismissedKey, "1");
    setVisible(false);
  };

  const enable = async () => {
    setWorking(true);
    setProblem("");
    const result = await subscribeThisDevice();
    setWorking(false);
    // Answered (enabled, blocked on purpose, or nothing to enable): stop asking. Real failures stay visible.
    if (result === "ok" || result === "denied" || result === "unconfigured" || result === "unsupported") dismiss();
    else setProblem(subscribeMessages[result]);
  };

  if (!visible) return null;
  return (
    <aside className="glass-panel fixed bottom-4 left-4 z-[70] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-[1.25rem] border border-border px-4 py-3.5 pr-11 text-sm shadow-2xl sm:left-auto sm:right-4 sm:w-[380px]" role="status">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><Bell size={16} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <strong className="block text-foreground">Activá avisos en este dispositivo</strong>
        <span className="mt-0.5 block text-muted">Te avisaremos sobre salidas y recordatorios importantes. Podés seguir usando el inbox aunque no los actives.</span>
        {problem ? <span className="mt-1.5 block text-danger">{problem}</span> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="shell-menu-item border border-border" disabled={working} onClick={() => void enable()} type="button">{working ? "Activando…" : problem ? "Reintentar" : "Activar avisos"}</button>
          <button className="shell-menu-item" onClick={dismiss} type="button">Ahora no</button>
        </div>
      </div>
      <button aria-label="Cerrar" className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground" onClick={dismiss} type="button"><X size={14} /></button>
    </aside>
  );
}
