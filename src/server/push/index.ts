import "server-only";

import { createECDH, createPrivateKey, hkdfSync, randomBytes, sign, createCipheriv } from "crypto";

type PushSubscription = { id: string; endpoint: string; p256dh: string; auth: string };
type PushEvent = { id: string; event_type: string; payload: { recipientId: string; slotDate?: string; detail?: string; title?: string; targetUrl?: string } };

export type PushEventRepository = {
  listPushSubscriptions: (recipientId: string) => Promise<PushSubscription[]>;
  removePushSubscription: (subscriptionId: string) => Promise<void>;
  recordPushDelivery: (eventId: string, recipientId: string, metadata: Record<string, unknown>) => Promise<void>;
};

type PushMessage = { title: string; body: string; url: string; tag: string };

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64url(value: string) {
  return Buffer.from(value, "base64url");
}

function vapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function getPublicVapidKey() {
  return vapidConfig()?.publicKey ?? null;
}

function pushMessage(event: PushEvent): PushMessage | null {
  if (event.event_type === "OUTING_ASSIGNED") return { title: "Nueva salida asignada", body: `Tenés una salida asignada para el ${event.payload.slotDate ?? "día programado"}.${event.payload.detail ? ` ${event.payload.detail}` : ""}`, url: "/?view=outings", tag: `outing-${event.id}` };
  if (event.event_type === "OUTING_UPDATED") return { title: "Tu salida fue actualizada", body: `Se actualizaron los datos de tu salida para el ${event.payload.slotDate ?? "día programado"}.${event.payload.detail ? ` ${event.payload.detail}` : ""}`, url: "/?view=outings", tag: `outing-${event.id}` };
  if (event.event_type === "VISIT_REPORT_DUE" && event.payload.title) return { title: event.payload.title, body: "Recordatorio: completá el informe de la salida.", url: event.payload.targetUrl ?? "/?view=outings", tag: `report-${event.id}` };
  return null;
}

function createVapidAuthorization(endpoint: string, config: NonNullable<ReturnType<typeof vapidConfig>>) {
  const audience = new URL(endpoint).origin;
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: config.subject }));
  const publicBytes = decodeBase64url(config.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error("La clave pública VAPID no es una clave P-256 válida.");
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: config.privateKey, x: base64url(publicBytes.subarray(1, 33)), y: base64url(publicBytes.subarray(33, 65)) }, format: "jwk" });
  const token = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(token), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${token}.${base64url(signature)}, k=${config.publicKey}`;
}

// RFC 8291 aes128gcm payload encryption. Keeping this native avoids making the
// application unavailable when optional npm credentials/dependencies are absent.
function encryptPayload(subscription: PushSubscription, plaintext: string) {
  const receiverPublicKey = decodeBase64url(subscription.p256dh);
  const authSecret = decodeBase64url(subscription.auth);
  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const sharedSecret = sender.computeSecret(receiverPublicKey);
  const ikmInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublicKey, sender.getPublicKey()]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, ikmInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([sender.getPublicKey().length]), sender.getPublicKey(), ciphertext]);
}

async function sendPush(subscription: PushSubscription, message: PushMessage, config: NonNullable<ReturnType<typeof vapidConfig>>) {
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: { TTL: "86400", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: createVapidAuthorization(subscription.endpoint, config) },
    body: encryptPayload(subscription, JSON.stringify(message)),
  });
  return response.status;
}

/** Best-effort push consumer for the persisted Fase 4 event outbox. */
export async function processPushNotification(repository: PushEventRepository, event: PushEvent) {
  const message = pushMessage(event);
  const config = vapidConfig();
  if (!message || !config) return { delivered: false, reason: "not-configured" as const };
  let subscriptions: PushSubscription[];
  try { subscriptions = await repository.listPushSubscriptions(event.payload.recipientId); }
  catch (error) { console.warn("No se pudieron consultar suscripciones push.", error); return { delivered: false, reason: "repository-error" as const }; }
  if (!subscriptions.length) return { delivered: false, reason: "no-subscriptions" as const };
  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      const status = await sendPush(subscription, message, config);
      if (status >= 200 && status < 300) delivered += 1;
      else if (status === 404 || status === 410) await repository.removePushSubscription(subscription.id);
      else console.warn(`Push rechazado con estado ${status}.`);
    } catch (error) { console.warn("No se pudo entregar push; se conserva el inbox interno.", error); }
  }
  if (delivered) await repository.recordPushDelivery(event.id, event.payload.recipientId, { devicesDelivered: delivered });
  return { delivered: delivered > 0, reason: delivered ? "sent" as const : "not-sent" as const };
}
