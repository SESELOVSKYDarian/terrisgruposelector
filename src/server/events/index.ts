import "server-only";

import { createAdminSupabaseClient } from "@/lib/server/auth";
import { processInternalNotification, type InternalEvent, type InternalEventRepository, type InternalNotification } from "./processor";

export const domainEventTypes = [
  "OUTING_ASSIGNED",
  "OUTING_UPDATED",
  "OUTING_CANCELLED",
  "OUTING_PUBLISHED",
  "OUTING_DRAFT_SUBMITTED",
  "OUTING_DRAFT_APPROVED",
  "GROUP_WINDOW_OPENED",
  "GROUP_WINDOW_REMINDER",
  "GROUP_RESERVATION_COMPLETED",
  "VISIT_REPORT_DUE",
  "VISIT_REPORT_SUBMITTED",
  "BUILDING_PROPOSED",
  "BUILDING_CENSUS_CORRECTION",
  "PERSONAL_TERRITORY_REPORT_DUE",
  "ANNOUNCEMENT_PUBLISHED",
] as const;

export type DomainEventType = (typeof domainEventTypes)[number];

type OutingEventPayload = {
  recipientId: string;
  slotId: string;
  weeklyOutingId: string;
  slotDate: string;
  conductorName?: string | null;
  detail?: string;
};

export type DomainEventPayloads = {
  OUTING_ASSIGNED: OutingEventPayload;
  OUTING_UPDATED: OutingEventPayload;
  OUTING_CANCELLED: OutingEventPayload;
  OUTING_PUBLISHED: { recipientId: string; outingId: string; startsOn: string };
  OUTING_DRAFT_SUBMITTED: { recipientId: string; outingId: string; startsOn: string };
  OUTING_DRAFT_APPROVED: { recipientId: string; outingId: string; startsOn: string };
  GROUP_WINDOW_OPENED: { recipientId: string; windowId: string; title: string };
  GROUP_WINDOW_REMINDER: { recipientId: string; windowId: string; title: string };
  GROUP_RESERVATION_COMPLETED: { recipientId: string; reservationId: string; title: string };
  VISIT_REPORT_DUE: { recipientId: string; territoryRoundId: string; title: string };
  VISIT_REPORT_SUBMITTED: { recipientId: string; reportId: string; title: string };
  BUILDING_PROPOSED: { recipientId: string; proposalId: string; title: string };
  BUILDING_CENSUS_CORRECTION: { recipientId: string; correctionId: string; title: string };
  PERSONAL_TERRITORY_REPORT_DUE: { recipientId: string; assignmentId: string; title: string };
  ANNOUNCEMENT_PUBLISHED: { recipientId: string; announcementId: string; title: string };
};

export type DomainEventInput<T extends DomainEventType> = {
  type: T;
  naturalKey: string;
  actorId?: string | null;
  payload: DomainEventPayloads[T];
};

type StoredEvent = { id: string; event_type: DomainEventType; payload: DomainEventPayloads[DomainEventType] };

export type EventRepository = {
  insertEvent: (input: DomainEventInput<DomainEventType>) => Promise<{ event: StoredEvent; created: boolean }>;
  createInternalNotification: (notification: InternalNotification) => Promise<boolean>;
  recordDelivery: (eventId: string, recipientId: string) => Promise<void>;
};

/** Processes only this phase's internal-inbox channel. Push, scheduled actions
 * and audit are deliberate future consumers of the same persisted event. */
export async function processDomainEvent(repository: EventRepository, event: StoredEvent) {
  return processInternalNotification(repository as InternalEventRepository, event as InternalEvent);
}

function supabaseRepository(): EventRepository {
  const supabase = createAdminSupabaseClient();
  return {
    async insertEvent(input) {
      const { data, error } = await supabase.from("domain_events").insert({ event_type: input.type, natural_key: input.naturalKey, actor_id: input.actorId ?? null, payload: input.payload }).select("id,event_type,payload").maybeSingle();
      if (!error && data) return { event: data as StoredEvent, created: true };
      if (error?.code !== "23505") throw new Error(error?.message ?? "No se pudo registrar el evento.");
      const { data: existing, error: existingError } = await supabase.from("domain_events").select("id,event_type,payload").eq("natural_key", input.naturalKey).single();
      if (existingError || !existing) throw new Error(existingError?.message ?? "No se pudo recuperar el evento existente.");
      return { event: existing as StoredEvent, created: false };
    },
    async createInternalNotification(notification) {
      const { error } = await supabase.from("user_notifications").insert({ event_id: notification.eventId, recipient_id: notification.recipientId, notification_type: notification.type, title: notification.title, description: notification.description, entity_type: notification.entityType, entity_id: notification.entityId, target_url: notification.targetUrl });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(error.message);
    },
    async recordDelivery(eventId, recipientId) {
      const { error } = await supabase.from("event_deliveries").upsert({ event_id: eventId, recipient_id: recipientId, channel: "IN_APP" }, { onConflict: "event_id,recipient_id,channel", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
  };
}

export async function emitDomainEvent<T extends DomainEventType>(input: DomainEventInput<T>) {
  const repository = supabaseRepository();
  const result = await repository.insertEvent(input as DomainEventInput<DomainEventType>);
  const delivery = await processDomainEvent(repository, result.event);
  return { eventId: result.event.id, eventCreated: result.created, ...delivery };
}
