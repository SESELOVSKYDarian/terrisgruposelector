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
