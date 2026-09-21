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

export type SubscribeResult = "ok" | "denied" | "unconfigured" | "unsupported" | "error";

/** Asks the browser for permission (only when the person clicks) and registers this device. */
export async function subscribeThisDevice(): Promise<SubscribeResult> {
  if (!pushSupported()) return "unsupported";
  try {
    const config = await fetch("/api/push-subscriptions", { cache: "no-store", credentials: "same-origin" });
    const { vapidPublicKey } = (await config.json()) as { vapidPublicKey: string | null };
    if (!config.ok || !vapidPublicKey) return "unconfigured";
    if ((await Notification.requestPermission()) !== "granted") return "denied";
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
    const response = await fetch("/api/push-subscriptions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: thisDeviceId(), deviceName: deviceName(), subscription: subscription.toJSON() }) });
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
