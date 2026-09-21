import "server-only";

import { createAdminSupabaseClient } from "@/lib/server/auth";
import { processInternalNotification, type InternalEvent, type InternalEventRepository, type InternalNotification } from "./processor";
import { processPushNotification, type PushEventRepository } from "@/server/push";

export const domainEventTypes = [
  "OUTING_ASSIGNED",
  "OUTING_UPDATED",
  "OUTING_CANCELLED",
  "OUTING_PUBLISHED",
  "OUTING_DRAFT_SUBMITTED",
  "OUTING_DRAFT_RETURNED",
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
  audience?: "conductor" | "reviewer";
};

type GroupWindowEventPayload = { recipientId: string; windowId: string; title: string; detail?: string };

type OutingWeekEventPayload = { recipientId: string; outingId: string; startsOn: string; detail?: string };

export type DomainEventPayloads = {
  OUTING_ASSIGNED: OutingEventPayload;
  OUTING_UPDATED: OutingEventPayload;
  OUTING_CANCELLED: OutingEventPayload;
  OUTING_PUBLISHED: OutingWeekEventPayload;
  OUTING_DRAFT_SUBMITTED: OutingWeekEventPayload;
  OUTING_DRAFT_RETURNED: OutingWeekEventPayload;
  OUTING_DRAFT_APPROVED: OutingWeekEventPayload;
  GROUP_WINDOW_OPENED: GroupWindowEventPayload;
  GROUP_WINDOW_REMINDER: GroupWindowEventPayload;
  GROUP_RESERVATION_COMPLETED: GroupWindowEventPayload;
  VISIT_REPORT_DUE: { recipientId: string; territoryRoundId: string; title: string; targetUrl?: string };
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
  listPushSubscriptions: (recipientId: string) => Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>;
  removePushSubscription: (subscriptionId: string) => Promise<void>;
  recordPushDelivery: (eventId: string, recipientId: string, metadata: Record<string, unknown>) => Promise<void>;
};

export async function processDomainEvent(repository: EventRepository, event: StoredEvent) {
  const internal = await processInternalNotification(repository as InternalEventRepository, event as InternalEvent);
  // Push is intentionally a best-effort secondary channel. Inbox delivery above
  // remains authoritative even when credentials, devices, or browsers fail.
  try { await processPushNotification(repository as PushEventRepository, event); }
  catch (error) { console.warn("El canal push falló; el inbox interno permanece entregado.", error); }
  return internal;
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
    async listPushSubscriptions(recipientId) {
      const { data, error } = await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("profile_id", recipientId).eq("enabled", true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async removePushSubscription(subscriptionId) {
      const { error } = await supabase.from("push_subscriptions").update({ enabled: false, disabled_at: new Date().toISOString() }).eq("id", subscriptionId);
      if (error) throw new Error(error.message);
    },
    async recordPushDelivery(eventId, recipientId, metadata) {
      const { error } = await supabase.from("event_deliveries").upsert({ event_id: eventId, recipient_id: recipientId, channel: "PUSH", metadata }, { onConflict: "event_id,recipient_id,channel", ignoreDuplicates: true });
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
