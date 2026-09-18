export type InternalNotification = { eventId: string; recipientId: string; type: string; title: string; description: string; entityType: string; entityId: string; targetUrl: string };
export type InternalEvent = { id: string; event_type: string; payload: { recipientId: string; slotId?: string; slotDate?: string; detail?: string } };
export type InternalEventRepository = { createInternalNotification: (notification: InternalNotification) => Promise<boolean>; recordDelivery: (eventId: string, recipientId: string) => Promise<void> };

/** Shared, database-agnostic delivery worker. The unique (event_id, recipient_id)
 * constraint is its durable idempotency guard; this return value exposes replays. */
export async function processInternalNotification(repository: InternalEventRepository, event: InternalEvent) {
  if (event.event_type !== "OUTING_ASSIGNED" && event.event_type !== "OUTING_UPDATED") return { delivered: false, reason: "no-internal-handler" as const };
  const payload = event.payload;
  if (!payload.slotId || !payload.slotDate) return { delivered: false, reason: "no-internal-handler" as const };
  const assigned = event.event_type === "OUTING_ASSIGNED";
  const notification: InternalNotification = { eventId: event.id, recipientId: payload.recipientId, type: event.event_type, title: assigned ? "Nueva salida asignada" : "Tu salida fue actualizada", description: `${assigned ? "Tienes una salida asignada" : "Se actualizaron los datos de tu salida"} para el ${payload.slotDate}.${payload.detail ? ` ${payload.detail}` : ""}`, entityType: "weekly_outing_slot", entityId: payload.slotId, targetUrl: "/?view=outings" };
  const created = await repository.createInternalNotification(notification);
  if (created) await repository.recordDelivery(event.id, notification.recipientId);
  return { delivered: created, reason: created ? "created" as const : "duplicate" as const };
}
