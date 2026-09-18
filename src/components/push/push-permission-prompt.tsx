"use client";

import { useEffect, useState } from "react";

const deviceStorageKey = "pr-territorios-push-device-id";
function deviceId() { const existing = localStorage.getItem(deviceStorageKey); if (existing) return existing; const created = crypto.randomUUID(); localStorage.setItem(deviceStorageKey, created); return created; }
function deviceName() { const platform = navigator.platform ?? "Dispositivo"; const browser = navigator.userAgent.includes("Edg/") ? "Edge" : navigator.userAgent.includes("Firefox/") ? "Firefox" : navigator.userAgent.includes("Chrome/") ? "Chrome" : "Navegador"; return `${platform} · ${browser}`.slice(0, 120); }
function urlBase64ToUint8Array(value: string) { const padding = "=".repeat((4 - value.length % 4) % 4); const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }

export function PushPermissionPrompt({ userId }: { userId: string }) {
  const dismissedKey = `pr-territorios-push-dismissed:${userId}`;
  const [visible, setVisible] = useState(false); const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  useEffect(() => { if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return; void navigator.serviceWorker.register("/sw.js").catch(() => {}); const timer = window.setTimeout(() => { if (Notification.permission === "default" && !localStorage.getItem(dismissedKey)) setVisible(true); }, 0); return () => window.clearTimeout(timer); }, [dismissedKey]);
  const dismiss = () => { localStorage.setItem(dismissedKey, "1"); setVisible(false); };
  const enable = async () => { setStatus("working"); try { const config = await fetch("/api/push-subscriptions", { cache: "no-store" }); const { vapidPublicKey } = await config.json() as { vapidPublicKey: string | null }; if (!config.ok || !vapidPublicKey) { dismiss(); return; } if (await Notification.requestPermission() !== "granted") { dismiss(); return; } const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }); const response = await fetch("/api/push-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: deviceId(), deviceName: deviceName(), subscription: subscription.toJSON() }) }); if (!response.ok) throw new Error(); dismiss(); } catch { setStatus("error"); } };
  if (!visible) return null;
  return <aside className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-sm" role="status"><div className="min-w-52 flex-1"><strong className="block">Activá avisos en este dispositivo</strong><span className="text-muted">Te avisaremos sobre salidas y recordatorios importantes. Podés seguir usando el inbox aunque no los actives.</span>{status === "error" ? <span className="mt-1 block text-danger">No se pudo activar ahora. Podés intentarlo más tarde.</span> : null}</div><button className="shell-menu-item border border-border" disabled={status === "working"} onClick={() => void enable()} type="button">{status === "working" ? "Activando…" : "Activar avisos"}</button><button className="shell-menu-item" onClick={dismiss} type="button">Ahora no</button></aside>;
}
