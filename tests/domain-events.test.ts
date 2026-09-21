import assert from "node:assert/strict";
import test from "node:test";

import { processInternalNotification, type InternalEventRepository, type InternalNotification } from "../src/server/events/processor";

test("procesar dos veces el mismo evento no duplica la notificación interna", async () => {
  const delivered = new Set<string>();
  const repository: InternalEventRepository = {
    async createInternalNotification(notification: InternalNotification) {
      const key = `${notification.eventId}:${notification.recipientId}`;
      if (delivered.has(key)) return false;
      delivered.add(key);
      return true;
    },
    async recordDelivery() {},
  };
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    event_type: "OUTING_ASSIGNED" as const,
    payload: { recipientId: "00000000-0000-4000-8000-000000000002", slotId: "00000000-0000-4000-8000-000000000003", weeklyOutingId: "00000000-0000-4000-8000-000000000004", slotDate: "2026-09-18" },
  };

  const first = await processInternalNotification(repository, event);
  const replay = await processInternalNotification(repository, event);

  assert.equal(first.delivered, true);
  assert.equal(replay.delivered, false);
  assert.equal(delivered.size, 1);
});

test("los eventos de planificación semanal generan notificaciones con destino y textos propios", async () => {
  const created: InternalNotification[] = [];
  const repository: InternalEventRepository = {
    async createInternalNotification(notification: InternalNotification) { created.push(notification); return true; },
    async recordDelivery() {},
  };
  const week = { recipientId: "reviewer", outingId: "week-1", startsOn: "24/09/2026" };
  for (const type of ["OUTING_DRAFT_SUBMITTED", "OUTING_DRAFT_RETURNED", "OUTING_DRAFT_APPROVED", "OUTING_PUBLISHED"]) {
    const result = await processInternalNotification(repository, { id: `evt-${type}`, event_type: type, payload: week });
    assert.equal(result.delivered, true, type);
  }
  assert.deepEqual(created.map((entry) => entry.title), ["Planificación lista para revisar", "Planificación devuelta a borrador", "Planificación aprobada", "Planificación semanal publicada"]);
  assert.ok(created.every((entry) => entry.entityType === "weekly_outing" && entry.entityId === "week-1"));

  const slot = { recipientId: "conductor", slotId: "slot-1", slotDate: "24/09/2026" };
  await processInternalNotification(repository, { id: "evt-cancel", event_type: "OUTING_CANCELLED", payload: { ...slot, audience: "conductor" } });
  await processInternalNotification(repository, { id: "evt-review", event_type: "OUTING_UPDATED", payload: { ...slot, audience: "reviewer", detail: "Editada por Siervo: hora." } });
  assert.equal(created.at(-2)?.title, "Tu salida fue cancelada");
  assert.equal(created.at(-1)?.title, "Salida publicada modificada");
  assert.match(created.at(-1)?.description ?? "", /Editada por Siervo: hora\./);
});

test("un evento de planificación sin datos suficientes no genera notificación", async () => {
  const repository: InternalEventRepository = { async createInternalNotification() { throw new Error("no debería crearse"); }, async recordDelivery() {} };
  const result = await processInternalNotification(repository, { id: "evt-x", event_type: "OUTING_PUBLISHED", payload: { recipientId: "u" } });
  assert.equal(result.reason, "no-internal-handler");
});
