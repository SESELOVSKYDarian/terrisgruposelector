export type InternalNotification = { eventId: string; recipientId: string; type: string; title: string; description: string; entityType: string; entityId: string; targetUrl: string };
export type InternalEvent = { id: string; event_type: string; payload: { recipientId: string; slotId?: string; slotDate?: string; detail?: string; title?: string; targetUrl?: string; outingId?: string; startsOn?: string; windowId?: string; reportId?: string; audience?: "conductor" | "reviewer" } };
export type InternalEventRepository = { createInternalNotification: (notification: InternalNotification) => Promise<boolean>; recordDelivery: (eventId: string, recipientId: string) => Promise<void> };

const OUTINGS_URL = "/?view=outings";
const MY_OUTINGS_URL = "/?view=myOutings";
const RESERVATIONS_URL = "/?view=reservations";

function withDetail(text: string, detail?: string) {
  return detail ? `${text} ${detail}` : text;
}

/** Maps a domain event to its inbox notification, or null when it has no internal handler. */
export function buildNotification(event: InternalEvent): InternalNotification | null {
  const payload = event.payload;
  const base = { eventId: event.id, recipientId: payload.recipientId, type: event.event_type };

  if (event.event_type === "VISIT_REPORT_DUE" && payload.slotId && payload.title) {
    return { ...base, title: payload.title, description: "Recordatorio: completá el informe de la salida.", entityType: "weekly_outing_slot", entityId: payload.slotId, targetUrl: payload.targetUrl ?? MY_OUTINGS_URL };
  }
  if (event.event_type === "VISIT_REPORT_SUBMITTED" && payload.reportId && payload.title) {
    return { ...base, title: "Informe de salida enviado", description: payload.title, entityType: "outing_report", entityId: payload.reportId, targetUrl: payload.targetUrl ?? OUTINGS_URL };
  }

  if (payload.slotId && payload.slotDate) {
    const reviewer = payload.audience === "reviewer";
    const slot = { entityType: "weekly_outing_slot", entityId: payload.slotId, targetUrl: reviewer ? OUTINGS_URL : `${MY_OUTINGS_URL}&highlight=${payload.slotId}` };
    if (event.event_type === "OUTING_ASSIGNED") {
      return { ...base, ...slot, title: "Nueva salida asignada", description: withDetail(`Tienes una salida asignada para el ${payload.slotDate}.`, payload.detail) };
    }
    if (event.event_type === "OUTING_UPDATED") {
      return { ...base, ...slot, title: reviewer ? "Salida publicada modificada" : "Tu salida fue actualizada", description: withDetail(`${reviewer ? "Se modificó una salida publicada" : "Se actualizaron los datos de tu salida"} para el ${payload.slotDate}.`, payload.detail) };
    }
    if (event.event_type === "OUTING_REMINDER") {
      return { ...base, ...slot, title: "Recordatorio de salida", description: withDetail(`Tenés una salida el ${payload.slotDate}.`, payload.detail) };
    }
    if (event.event_type === "OUTING_CANCELLED") {
      return { ...base, ...slot, title: reviewer ? "Salida cancelada" : "Tu salida fue cancelada", description: withDetail(`${reviewer ? "Se canceló una salida" : "Se canceló tu salida"} del ${payload.slotDate}.`, payload.detail) };
    }
  }

  if (payload.windowId && payload.title) {
    const window = { entityType: "reservation_window", entityId: payload.windowId, targetUrl: RESERVATIONS_URL };
    const body = withDetail(payload.title, payload.detail);
    if (event.event_type === "GROUP_WINDOW_OPENED") return { ...base, ...window, title: "Salida por Grupo: completá la información", description: body };
    if (event.event_type === "GROUP_WINDOW_REMINDER") return { ...base, ...window, title: "Recordatorio: Salida por Grupo", description: body };
    if (event.event_type === "GROUP_RESERVATION_COMPLETED") return { ...base, ...window, title: "Salida por Grupo completada", description: body };
  }

  if (payload.outingId && payload.startsOn) {
    const week = { entityType: "weekly_outing", entityId: payload.outingId, targetUrl: OUTINGS_URL };
    const range = `la semana del ${payload.startsOn}`;
    if (event.event_type === "OUTING_DRAFT_SUBMITTED") {
      return { ...base, ...week, title: "Planificación lista para revisar", description: withDetail(`La planificación de ${range} fue enviada a revisión.`, payload.detail) };
    }
    if (event.event_type === "OUTING_DRAFT_RETURNED") {
      return { ...base, ...week, title: "Planificación devuelta a borrador", description: withDetail(`La planificación de ${range} volvió a borrador para ajustes.`, payload.detail) };
    }
    if (event.event_type === "OUTING_DRAFT_APPROVED") {
      return { ...base, ...week, title: "Planificación aprobada", description: withDetail(`La planificación de ${range} fue aprobada y publicada.`, payload.detail) };
    }
    if (event.event_type === "OUTING_PUBLISHED") {
      return { ...base, ...week, title: "Planificación semanal publicada", description: withDetail(`Ya está publicada la planificación de ${range}. Revisá tus salidas.`, payload.detail) };
    }
  }

  return null;
}

/** Shared, database-agnostic delivery worker. The unique (event_id, recipient_id)
 * constraint is its durable idempotency guard; this return value exposes replays. */
export async function processInternalNotification(repository: InternalEventRepository, event: InternalEvent) {
  const notification = buildNotification(event);
  if (!notification) return { delivered: false, reason: "no-internal-handler" as const };
  const created = await repository.createInternalNotification(notification);
  if (created) await repository.recordDelivery(event.id, notification.recipientId);
  return { delivered: created, reason: created ? "created" as const : "duplicate" as const };
}
