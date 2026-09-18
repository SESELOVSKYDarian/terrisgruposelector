-- Fase 4: outbox de eventos e inbox interno por usuario.
-- Es aditiva e idempotente; no altera las notificaciones legacy de administracion.

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  natural_key text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint domain_events_event_type_not_blank check (length(trim(event_type)) > 0),
  constraint domain_events_natural_key_not_blank check (length(trim(natural_key)) > 0),
  constraint domain_events_natural_key_unique unique (natural_key)
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.domain_events(id) on delete set null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  description text not null,
  entity_type text,
  entity_id uuid,
  target_url text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_notifications_target check (entity_type is null or entity_id is not null),
  constraint user_notifications_event_recipient_unique unique nulls not distinct (event_id, recipient_id)
);

-- Reservado para canales futuros (push, acciones programadas y auditoria).
create table if not exists public.event_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.domain_events(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  channel text not null,
  delivered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint event_deliveries_channel_not_blank check (length(trim(channel)) > 0),
  constraint event_deliveries_unique unique nulls not distinct (event_id, recipient_id, channel)
);

create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications (recipient_id, created_at desc);
create index if not exists user_notifications_recipient_unread_idx
  on public.user_notifications (recipient_id, created_at desc)
  where read_at is null;
create index if not exists user_notifications_expiry_idx
  on public.user_notifications (created_at);

alter table public.domain_events enable row level security;
alter table public.user_notifications enable row level security;
alter table public.event_deliveries enable row level security;

-- The app uses a server-only service role, but these policies keep direct Data API
-- access scoped to the authenticated recipient should that be introduced later.
create policy "users read own notifications"
on public.user_notifications for select to authenticated
using ((select auth.uid()) = recipient_id);

create policy "users update own notifications"
on public.user_notifications for update to authenticated
using ((select auth.uid()) = recipient_id)
with check ((select auth.uid()) = recipient_id);

create policy "users delete own notifications"
on public.user_notifications for delete to authenticated
using ((select auth.uid()) = recipient_id);
