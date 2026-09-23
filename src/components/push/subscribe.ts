"use client";

const DEVICE_KEY = "pr-territorios-push-device-id";

/** Stable id of this browser, shared with the post-login prompt so a device is never registered twice. */
export function thisDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_KEY, created);
  return created;
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function deviceName() {
  const browser = navigator.userAgent.includes("Edg/") ? "Edge" : navigator.userAgent.includes("Firefox/") ? "Firefox" : navigator.userAgent.includes("Chrome/") ? "Chrome" : "Navegador";
  return `${browser} · ${navigator.platform || "Dispositivo"}`.slice(0, 120);
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export type SubscribeResult = "ok" | "denied" | "unconfigured" | "unsupported" | "invalid-key" | "push-blocked" | "save-failed" | "error";

export const subscribeMessages: Record<SubscribeResult, string> = {
  ok: "Listo: este dispositivo ya recibe avisos.",
  denied: "El navegador bloqueó los avisos. Podés habilitarlos desde la configuración del sitio.",
  unconfigured: "Los avisos push todavía no están configurados en este servidor. Tus notificaciones internas siguen funcionando.",
  unsupported: "Este navegador no admite avisos push. Tus notificaciones internas siguen funcionando.",
  "invalid-key": "La clave de avisos del servidor está mal cargada. Avisale a quien administra el sistema.",
  "push-blocked": "Tu navegador no pudo conectarse con su servicio de avisos. Suele pasar con Brave, bloqueadores o redes que lo bloquean: probá en Chrome o Edge.",
  "save-failed": "El navegador aceptó los avisos, pero no se pudieron guardar. Probá de nuevo.",
  error: "No se pudo activar ahora. Probá de nuevo más tarde.",
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new DOMException("Timeout", "TimeoutError")), ms);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

function classifyFailure(error: unknown): SubscribeResult {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") return "denied";
  if (name === "InvalidAccessError" || name === "InvalidCharacterError") return "invalid-key";
  if (name === "AbortError" || name === "NetworkError" || name === "TimeoutError") return "push-blocked";
  return "error";
}

/** Asks the browser for permission (only when the person clicks) and registers this device. */
export async function subscribeThisDevice(): Promise<SubscribeResult> {
  if (!pushSupported()) return "unsupported";
  try {
    const config = await fetch("/api/push-subscriptions", { cache: "no-store", credentials: "same-origin" });
    const { vapidPublicKey, vapidProblem } = (await config.json()) as { vapidPublicKey: string | null; vapidProblem?: string | null };
    if (!config.ok) return "error";
    if (!vapidPublicKey) return vapidProblem && vapidProblem !== "missing" ? "invalid-key" : "unconfigured";
    if ((await Notification.requestPermission()) !== "granted") return "denied";
    await navigator.serviceWorker.register("/sw.js");
    const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    const subscribe = () => withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }), 15000);
    let subscription: PushSubscription;
    try {
      subscription = await subscribe();
    } catch (error) {
      // A subscription made with another key (e.g. before the VAPID keys were set) blocks a new one.
      if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      subscription = await subscribe();
    }
    const response = await fetch("/api/push-subscriptions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: thisDeviceId(), deviceName: deviceName(), subscription: subscription.toJSON() }) });
    return response.ok ? "ok" : "save-failed";
  } catch (error) {
    console.error("No se pudo activar los avisos push:", error);
    return classifyFailure(error);
  }
}
