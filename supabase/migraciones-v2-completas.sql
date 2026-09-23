-- Migraciones V2 completas, en orden. Generado a partir de supabase/fase-*.sql el 2026-09-22.
-- Correr UNA sola vez contra la base real (o staging). Es aditivo: no borra ni pisa datos existentes.
-- Fuente de verdad: los archivos individuales supabase/fase-N-*.sql (por si hay que revisar o re-correr uno solo).


-- ============================================================
-- fase-1-user-permissions-migration.sql
-- ============================================================
-- Fase 1: modelo V2 de nombramientos, características y responsabilidades.
-- Esta migración es estrictamente aditiva. No modifica ni elimina los roles legacy.
-- Aplicar después de las migraciones existentes, en una copia/staging antes de producción.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_appointment_kind') then
    create type public.profile_appointment_kind as enum ('ANCIANO', 'SIERVO_MINISTERIAL', 'PUBLICADOR');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_capability_kind') then
    create type public.profile_capability_kind as enum ('CONDUCTOR', 'PRECURSOR');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_responsibility_kind') then
    create type public.profile_responsibility_kind as enum (
      'COORDINADOR',
      'SUPERINTENDENTE_SERVICIO',
      'SIERVO_TERRITORIOS',
      'SUPERINTENDENTE_GRUPO',
      'AUXILIAR_GRUPO'
    );
  end if;
end
$$;

alter table public.profiles
  add column if not exists v2_permissions_backfilled_at timestamptz,
  add column if not exists v2_permissions_backfill_source text;

create table if not exists public.profile_appointments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  appointment public.profile_appointment_kind not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.assert_v2_exactly_one_appointment(target_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- A deleted profile no longer needs an appointment; ON DELETE CASCADE is
  -- therefore compatible with this deferred invariant.
  if not exists (select 1 from public.profiles where id = target_profile_id) then
    return;
  end if;

  if (select count(*) from public.profile_appointments where profile_id = target_profile_id) <> 1 then
    raise exception 'Cada perfil debe tener exactamente un nombramiento V2.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_v2_profile_appointment_count()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.assert_v2_exactly_one_appointment(coalesce(new.profile_id, old.profile_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_v2_new_profile_appointment_count()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.assert_v2_exactly_one_appointment(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create table if not exists public.profile_capabilities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  capability public.profile_capability_kind not null,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint profile_capabilities_revocation_matches_active check (
    (active and revoked_at is null) or (not active and revoked_at is not null)
  ),
  unique (profile_id, capability)
);

-- Keeps the V2 invariant for accounts created while the V1 user form still
-- writes profiles.role. Legacy role changes are intentionally not mirrored:
-- V2 becomes the source of truth for all new permission-management routes.
create or replace function public.ensure_v2_profile_appointment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.profile_appointments (profile_id, appointment)
  values (
    new.id,
    case
      when new.role in ('ADMIN', 'ANCIANO') then 'ANCIANO'::public.profile_appointment_kind
      when new.role = 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
      else 'PUBLICADOR'::public.profile_appointment_kind
    end
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_v2_profile_appointment_after_insert on public.profiles;
create trigger ensure_v2_profile_appointment_after_insert
after insert on public.profiles
for each row execute function public.ensure_v2_profile_appointment();

drop trigger if exists enforce_v2_profile_appointment_count on public.profile_appointments;
create constraint trigger enforce_v2_profile_appointment_count
after insert or update or delete on public.profile_appointments
deferrable initially deferred
for each row execute function public.enforce_v2_profile_appointment_count();

drop trigger if exists enforce_v2_new_profile_appointment_count on public.profiles;
create constraint trigger enforce_v2_new_profile_appointment_count
after insert or delete on public.profiles
deferrable initially deferred
for each row execute function public.enforce_v2_new_profile_appointment_count();

create table if not exists public.profile_responsibilities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  responsibility public.profile_responsibility_kind not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_responsibilities_only_global check (
    responsibility in ('COORDINADOR', 'SUPERINTENDENTE_SERVICIO', 'SIERVO_TERRITORIOS')
  ),
  constraint profile_responsibilities_dates check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists profile_responsibilities_one_active_per_profile_kind
  on public.profile_responsibilities(profile_id, responsibility)
  where ended_at is null;

create table if not exists public.group_responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  responsibility public.profile_responsibility_kind not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_responsibility_assignments_only_group check (
    responsibility in ('SUPERINTENDENTE_GRUPO', 'AUXILIAR_GRUPO')
  ),
  constraint group_responsibility_assignments_dates check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists group_responsibility_assignments_one_active_per_group_kind
  on public.group_responsibility_assignments(group_id, responsibility)
  where ended_at is null;

create index if not exists group_responsibility_assignments_profile_active_idx
  on public.group_responsibility_assignments(profile_id)
  where ended_at is null;

create table if not exists public.permission_audit_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  source text not null,
  legacy_roles jsonb not null default '[]'::jsonb,
  appointment public.profile_appointment_kind,
  capabilities jsonb not null default '[]'::jsonb,
  global_responsibilities jsonb not null default '[]'::jsonb,
  group_responsibilities jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists permission_audit_snapshots_profile_captured_idx
  on public.permission_audit_snapshots(profile_id, captured_at desc);

-- These functions are trigger-only guards. They run with the caller's rights,
-- use a fixed search path, and are not exposed for direct API execution.
create or replace function public.assert_v2_responsibility_eligibility(
  target_profile_id uuid,
  target_responsibility public.profile_responsibility_kind
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_appointment public.profile_appointment_kind;
  has_driver_capability boolean;
begin
  select appointment into current_appointment
  from public.profile_appointments
  where profile_id = target_profile_id;

  select exists(
    select 1
    from public.profile_capabilities
    where profile_id = target_profile_id
      and capability = 'CONDUCTOR'
      and active
  ) into has_driver_capability;

  if current_appointment is null then
    raise exception 'El perfil debe tener un nombramiento V2 antes de asignar una responsabilidad.'
      using errcode = '23514';
  end if;

  if target_responsibility in ('COORDINADOR', 'SUPERINTENDENTE_SERVICIO')
    and not (current_appointment = 'ANCIANO' and has_driver_capability) then
    raise exception 'La responsabilidad % requiere ANCIANO y CONDUCTOR.', target_responsibility
      using errcode = '23514';
  end if;

  if target_responsibility = 'SUPERINTENDENTE_GRUPO'
    and current_appointment <> 'ANCIANO' then
    raise exception 'SUPERINTENDENTE_GRUPO requiere ANCIANO.' using errcode = '23514';
  end if;

  if target_responsibility in ('SIERVO_TERRITORIOS', 'AUXILIAR_GRUPO')
    and current_appointment not in ('ANCIANO', 'SIERVO_MINISTERIAL') then
    raise exception 'La responsabilidad % requiere ANCIANO o SIERVO_MINISTERIAL.', target_responsibility
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.validate_v2_global_responsibility()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.ended_at is null then
    perform public.assert_v2_responsibility_eligibility(new.profile_id, new.responsibility);
  end if;
  return new;
end;
$$;

create or replace function public.validate_v2_group_responsibility()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.ended_at is null then
    perform public.assert_v2_responsibility_eligibility(new.profile_id, new.responsibility);
  end if;
  return new;
end;
$$;

create or replace function public.prevent_v2_permission_dependency_break()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  responsibility_row record;
begin
  for responsibility_row in
    select profile_id, responsibility
    from public.profile_responsibilities
    where profile_id = new.profile_id and ended_at is null
    union all
    select profile_id, responsibility
    from public.group_responsibility_assignments
    where profile_id = new.profile_id and ended_at is null
  loop
    perform public.assert_v2_responsibility_eligibility(
      responsibility_row.profile_id,
      responsibility_row.responsibility
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_v2_global_responsibility_before_write on public.profile_responsibilities;
create trigger validate_v2_global_responsibility_before_write
before insert or update of profile_id, responsibility, ended_at on public.profile_responsibilities
for each row execute function public.validate_v2_global_responsibility();

drop trigger if exists validate_v2_group_responsibility_before_write on public.group_responsibility_assignments;
create trigger validate_v2_group_responsibility_before_write
before insert or update of profile_id, responsibility, ended_at on public.group_responsibility_assignments
for each row execute function public.validate_v2_group_responsibility();

drop trigger if exists prevent_v2_appointment_dependency_break on public.profile_appointments;
create trigger prevent_v2_appointment_dependency_break
after update of appointment on public.profile_appointments
for each row execute function public.prevent_v2_permission_dependency_break();

drop trigger if exists prevent_v2_capability_dependency_break on public.profile_capabilities;
create trigger prevent_v2_capability_dependency_break
after update of active on public.profile_capabilities
for each row execute function public.prevent_v2_permission_dependency_break();

-- Capture the legacy state before mapping it. The snapshot is append-only from
-- the migration's perspective and gives operators a review record without
-- altering profiles.role or profile_roles.
insert into public.permission_audit_snapshots (
  profile_id,
  source,
  legacy_roles,
  appointment,
  capabilities,
  global_responsibilities,
  metadata
)
select
  p.id,
  'fase-1-backfill',
  legacy.legacy_roles,
  case
    when legacy.legacy_roles ? 'ADMIN' or legacy.legacy_roles ? 'ANCIANO' then 'ANCIANO'::public.profile_appointment_kind
    when legacy.legacy_roles ? 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
    else 'PUBLICADOR'::public.profile_appointment_kind
  end,
  case when legacy.legacy_roles ? 'ADMIN' or legacy.legacy_roles ? 'CONDUCTOR' then '["CONDUCTOR"]'::jsonb else '[]'::jsonb end,
  case when legacy.legacy_roles ? 'ADMIN' then '["COORDINADOR"]'::jsonb else '[]'::jsonb end,
  jsonb_build_object('legacy_profile_role', p.role::text)
from public.profiles p
cross join lateral (
  select coalesce(jsonb_agg(distinct role), '[]'::jsonb) || case
    when p.role is null then '[]'::jsonb else jsonb_build_array(p.role::text)
  end as legacy_roles
  from public.profile_roles
  where profile_id = p.id
) legacy
where not exists (
  select 1 from public.permission_audit_snapshots snapshot
  where snapshot.profile_id = p.id and snapshot.source = 'fase-1-backfill'
);

insert into public.profile_appointments (profile_id, appointment)
select
  p.id,
  case
    when exists (select 1 from public.profile_roles pr where pr.profile_id = p.id and pr.role in ('ADMIN', 'ANCIANO'))
      or p.role in ('ADMIN', 'ANCIANO') then 'ANCIANO'::public.profile_appointment_kind
    when exists (select 1 from public.profile_roles pr where pr.profile_id = p.id and pr.role = 'PUBLICADOR')
      or p.role = 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
    else 'PUBLICADOR'::public.profile_appointment_kind
  end
from public.profiles p
on conflict (profile_id) do nothing;

insert into public.profile_capabilities (profile_id, capability, active)
select p.id, 'CONDUCTOR'::public.profile_capability_kind, true
from public.profiles p
where p.role = 'ADMIN'
   or exists (
     select 1 from public.profile_roles pr
     where pr.profile_id = p.id and pr.role in ('ADMIN', 'CONDUCTOR')
   )
on conflict (profile_id, capability) do nothing;

insert into public.profile_responsibilities (profile_id, responsibility)
select p.id, 'COORDINADOR'::public.profile_responsibility_kind
from public.profiles p
where p.role = 'ADMIN'
   or exists (
     select 1 from public.profile_roles pr
     where pr.profile_id = p.id and pr.role = 'ADMIN'
   )
on conflict do nothing;

update public.profiles
set v2_permissions_backfilled_at = coalesce(v2_permissions_backfilled_at, now()),
    v2_permissions_backfill_source = coalesce(v2_permissions_backfill_source, 'fase-1-legacy-roles')
where v2_permissions_backfilled_at is null;

-- The backfill above queued deferred constraint-trigger events on profile_appointments/profiles
-- (enforce_v2_*_appointment_count). Firing them now clears the queue so the ALTER TABLE calls below
-- are allowed in this same transaction (Postgres refuses to ALTER a table with pending trigger events).
set constraints all immediate;

alter table public.profile_appointments enable row level security;
alter table public.profile_capabilities enable row level security;
alter table public.profile_responsibilities enable row level security;
alter table public.group_responsibility_assignments enable row level security;
alter table public.permission_audit_snapshots enable row level security;

revoke all on table public.profile_appointments, public.profile_capabilities,
  public.profile_responsibilities, public.group_responsibility_assignments,
  public.permission_audit_snapshots from anon, authenticated;
revoke all on function public.assert_v2_responsibility_eligibility(uuid, public.profile_responsibility_kind) from public, anon, authenticated;
revoke all on function public.assert_v2_exactly_one_appointment(uuid) from public, anon, authenticated;
revoke all on function public.enforce_v2_profile_appointment_count() from public, anon, authenticated;
revoke all on function public.enforce_v2_new_profile_appointment_count() from public, anon, authenticated;
revoke all on function public.ensure_v2_profile_appointment() from public, anon, authenticated;
revoke all on function public.validate_v2_global_responsibility() from public, anon, authenticated;
revoke all on function public.validate_v2_group_responsibility() from public, anon, authenticated;
revoke all on function public.prevent_v2_permission_dependency_break() from public, anon, authenticated;
grant execute on function public.assert_v2_responsibility_eligibility(uuid, public.profile_responsibility_kind) to service_role;
grant execute on function public.assert_v2_exactly_one_appointment(uuid) to service_role;
grant execute on function public.enforce_v2_profile_appointment_count() to service_role;
grant execute on function public.enforce_v2_new_profile_appointment_count() to service_role;
grant execute on function public.ensure_v2_profile_appointment() to service_role;
grant execute on function public.validate_v2_global_responsibility() to service_role;
grant execute on function public.validate_v2_group_responsibility() to service_role;
grant execute on function public.prevent_v2_permission_dependency_break() to service_role;

commit;


-- ============================================================
-- fase-4-events-notifications-migration.sql
-- ============================================================
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


-- ============================================================
-- fase-5-push-scheduler-migration.sql
-- ============================================================
-- Fase 5: dispositivos push y registro aditivo de ejecuciones del scheduler.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null, device_name text not null, endpoint text not null, p256dh text not null, auth text not null,
  enabled boolean not null default true, disabled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint push_subscriptions_device_name_not_blank check (length(trim(device_name)) > 0),
  constraint push_subscriptions_user_device_unique unique (profile_id, device_id), constraint push_subscriptions_endpoint_unique unique (endpoint)
);
create index if not exists push_subscriptions_profile_enabled_idx on public.push_subscriptions (profile_id) where enabled;
create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), job_type text not null, natural_key text not null, run_after timestamptz not null,
  status text not null default 'PENDING', payload jsonb not null default '{}'::jsonb, last_error text, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint scheduled_jobs_status_valid check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')), constraint scheduled_jobs_natural_key_unique unique (natural_key)
);
create index if not exists scheduled_jobs_due_idx on public.scheduled_jobs (run_after) where status = 'PENDING';
alter table public.push_subscriptions enable row level security;
alter table public.scheduled_jobs enable row level security;
create policy "users manage own push subscriptions" on public.push_subscriptions for all to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);


-- ============================================================
-- fase-6-weekly-planning-workflow-migration.sql
-- ============================================================
-- Fase 6: workflow de planificacion semanal (DRAFT -> IN_REVIEW -> PUBLISHED),
-- estados de salida, timestamps reales (America/Argentina/Buenos_Aires) y auditoria.
-- Es aditiva e idempotente: no borra ni reescribe datos existentes. Las semanas que
-- ya existian quedan como PUBLISHED (eran el plan operativo vigente).

begin;

-- ---------------------------------------------------------------------------
-- Auditoria generica (las fases siguientes la extienden, no la reemplazan).
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_blank check (length(trim(action)) > 0),
  constraint audit_log_entity_type_not_blank check (length(trim(entity_type)) > 0)
);

create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Workflow de la planificacion (semana).
-- ---------------------------------------------------------------------------
alter table public.weekly_outings add column if not exists status text not null default 'PUBLISHED';
alter table public.weekly_outings add column if not exists submitted_at timestamptz;
alter table public.weekly_outings add column if not exists submitted_by uuid references public.profiles(id) on delete set null;
alter table public.weekly_outings add column if not exists approved_at timestamptz;
alter table public.weekly_outings add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.weekly_outings add column if not exists published_at timestamptz;
alter table public.weekly_outings add column if not exists published_by uuid references public.profiles(id) on delete set null;

-- Filas previas: ya eran el plan vigente. Filas nuevas empiezan como borrador.
update public.weekly_outings set published_at = coalesce(published_at, created_at) where status = 'PUBLISHED' and published_at is null;
alter table public.weekly_outings alter column status set default 'DRAFT';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_outings_status_check') then
    alter table public.weekly_outings
      add constraint weekly_outings_status_check check (status in ('DRAFT', 'IN_REVIEW', 'PUBLISHED'));
  end if;
end $$;

create index if not exists weekly_outings_status_starts_idx on public.weekly_outings (status, starts_on desc);

-- ---------------------------------------------------------------------------
-- Estado por salida + timestamp real.
-- ---------------------------------------------------------------------------
alter table public.weekly_outing_slots add column if not exists status text not null default 'PROGRAMADA';
alter table public.weekly_outing_slots add column if not exists starts_at timestamptz;
alter table public.weekly_outing_slots add column if not exists time_parse_status text;
alter table public.weekly_outing_slots add column if not exists cancelled_at timestamptz;
alter table public.weekly_outing_slots add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_outing_slots_status_check') then
    alter table public.weekly_outing_slots
      add constraint weekly_outing_slots_status_check check (status in ('PROGRAMADA', 'REALIZADA', 'CANCELADA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'weekly_outing_slots_time_parse_status_check') then
    alter table public.weekly_outing_slots
      add constraint weekly_outing_slots_time_parse_status_check check (time_parse_status in ('PARSED', 'EMPTY', 'UNPARSEABLE'));
  end if;
end $$;

create index if not exists weekly_outing_slots_starts_at_idx on public.weekly_outing_slots (starts_at);

-- Espejo SQL de src/modules/outings/time.ts (parseOutingTime). Acepta "18:30", "18.30",
-- "18h30", "18 hs", "9 am", "9:15 p.m."; cualquier otra cosa devuelve null (no se adivina).
create or replace function public.parse_outing_time(raw text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  h integer;
  mi integer;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  m := regexp_match(lower(btrim(raw)), '^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:(a\.?\s?m\.?|p\.?\s?m\.?)|hs?\.?|hrs?\.?|horas?)?$');
  if m is null then
    return null;
  end if;
  h := m[1]::integer;
  mi := coalesce(m[2]::integer, 0);
  if mi > 59 then
    return null;
  end if;
  if m[3] is not null then
    if h < 1 or h > 12 then
      return null;
    end if;
    if m[3] like 'p%' and h < 12 then
      h := h + 12;
    elsif m[3] like 'a%' and h = 12 then
      h := 0;
    end if;
  elsif h > 23 then
    return null;
  end if;
  return make_time(h, mi, 0);
end;
$$;

-- El trigger es la unica fuente de verdad de starts_at: cubre la UI legacy y la V2.
create or replace function public.sync_weekly_outing_slot_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parsed time;
begin
  parsed := public.parse_outing_time(new.hora);
  if new.hora is null or btrim(new.hora) = '' then
    new.time_parse_status := 'EMPTY';
    new.starts_at := null;
  elsif parsed is null then
    new.time_parse_status := 'UNPARSEABLE';
    new.starts_at := null;
  else
    new.time_parse_status := 'PARSED';
    new.starts_at := (new.slot_date + parsed) at time zone 'America/Argentina/Buenos_Aires';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_outing_slots_sync_time on public.weekly_outing_slots;
create trigger weekly_outing_slots_sync_time
before insert or update of hora, slot_date on public.weekly_outing_slots
for each row execute function public.sync_weekly_outing_slot_time();

-- Filas que no se pudieron interpretar: se listan, no se descartan ni se corrompen.
create table if not exists public.weekly_outing_time_backfill_issues (
  slot_id uuid primary key references public.weekly_outing_slots(id) on delete cascade,
  hora text,
  reason text not null,
  detected_at timestamptz not null default now()
);

alter table public.weekly_outing_time_backfill_issues enable row level security;
revoke all on table public.weekly_outing_time_backfill_issues from anon, authenticated;

-- Backfill idempotente: `update of hora` dispara el trigger aunque el valor no cambie.
update public.weekly_outing_slots set hora = hora where time_parse_status is null;

insert into public.weekly_outing_time_backfill_issues (slot_id, hora, reason)
select id, hora, 'hora en texto libre que no coincide con un formato horario reconocido'
from public.weekly_outing_slots
where time_parse_status = 'UNPARSEABLE'
on conflict (slot_id) do nothing;

revoke all on function public.parse_outing_time(text) from public, anon, authenticated;
revoke all on function public.sync_weekly_outing_slot_time() from public, anon, authenticated;
grant execute on function public.parse_outing_time(text) to service_role;
grant execute on function public.sync_weekly_outing_slot_time() to service_role;

commit;


-- ============================================================
-- fase-7-recurring-conductors-migration.sql
-- ============================================================
-- Fase 7: plantilla semanal recurrente de salidas con conductor predeterminado (estrella).
-- Aditiva e idempotente. La plantilla no se modifica al ajustar una semana puntual: las
-- filas de la semana (weekly_outing_slots) son el override, la plantilla es la estrella.

begin;

create table if not exists public.recurring_outing_slots (
  id uuid primary key default gen_random_uuid(),
  -- ISO: 1 = lunes ... 7 = domingo. Un mismo dia puede tener varias filas y horas especiales.
  isodow smallint not null check (isodow between 1 and 7),
  hora time not null,
  lugar text,
  -- Conductor semanal predeterminado (la estrella). Nulo = sin conductor fijo.
  default_conductor_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurring_outing_slots_day_idx on public.recurring_outing_slots (isodow, hora) where active;

-- Vincula cada fila de una semana con la fila de plantilla que la origino (si existe).
alter table public.weekly_outing_slots
  add column if not exists template_slot_id uuid references public.recurring_outing_slots(id) on delete set null;

-- Aplicar la plantilla dos veces a la misma semana no duplica filas.
create unique index if not exists weekly_outing_slots_template_unique
  on public.weekly_outing_slots (weekly_outing_id, template_slot_id)
  where template_slot_id is not null;

alter table public.recurring_outing_slots enable row level security;
revoke all on table public.recurring_outing_slots from anon, authenticated;

commit;


-- ============================================================
-- fase-8-group-outings-migration.sql
-- ============================================================
-- Fase 8: Salida por Grupo. La "ventana" sigue siendo reservation_windows; cada grupo
-- responde una vez por fecha (lugar obligatorio, conductor, hora, territorios) y esa
-- respuesta alimenta automaticamente la planificacion semanal y las reservas/bloqueos.
-- Aditiva e idempotente: no toca reservas ni ventanas existentes.

begin;

create table if not exists public.group_outing_responses (
  id uuid primary key default gen_random_uuid(),
  reservation_window_id uuid not null references public.reservation_windows(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  service_date date not null,
  lugar text not null,
  conductor_id uuid references public.profiles(id) on delete set null,
  -- "HH:MM" (America/Argentina/Buenos_Aires); el instante real vive en la fila de planificacion.
  hora text,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint group_outing_responses_lugar_not_blank check (length(btrim(lugar)) > 0),
  constraint group_outing_responses_hora_format check (hora is null or hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint group_outing_responses_weekend check (extract(isodow from service_date) in (6, 7)),
  constraint group_outing_responses_unique unique (reservation_window_id, group_id, service_date)
);

create index if not exists group_outing_responses_window_idx on public.group_outing_responses (reservation_window_id, service_date);

-- Los territorios de la respuesta son sus reservas: asi se reutilizan los bloqueos existentes.
alter table public.territory_reservations
  add column if not exists group_response_id uuid references public.group_outing_responses(id) on delete set null;
create index if not exists territory_reservations_group_response_idx on public.territory_reservations (group_response_id) where group_response_id is not null;

-- La respuesta genera (y luego mantiene) exactamente una fila de planificacion.
alter table public.weekly_outing_slots
  add column if not exists group_id uuid references public.groups(id) on delete set null,
  add column if not exists group_response_id uuid references public.group_outing_responses(id) on delete set null;
create unique index if not exists weekly_outing_slots_group_response_unique
  on public.weekly_outing_slots (group_response_id) where group_response_id is not null;

alter table public.group_outing_responses enable row level security;
revoke all on table public.group_outing_responses from anon, authenticated;

commit;


-- ============================================================
-- fase-9-outing-reports-migration.sql
-- ============================================================
-- Fase 9: informe de salida vinculado a la salida planificada (Mis salidas).
-- Cada informe cuelga de una fila de planificacion y genera una visita por territorio
-- sobre las tablas de vueltas existentes (territory_rounds / territory_visits).
-- Aditiva e idempotente: las visitas y vueltas historicas no se modifican.

begin;

create table if not exists public.outing_reports (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.weekly_outing_slots(id) on delete cascade,
  -- Conductor responsable de la salida (el asignado en la planificacion).
  conductor_id uuid references public.profiles(id) on delete set null,
  -- Quien cargo el informe por primera vez / la ultima vez (puede ser Superintendente o Siervo por el conductor).
  submitted_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.territory_visits
  add column if not exists outing_report_id uuid references public.outing_reports(id) on delete set null,
  add column if not exists slot_id uuid references public.weekly_outing_slots(id) on delete set null,
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  -- false = territorio agregado durante la salida que no estaba planificado.
  add column if not exists planned boolean not null default true;

-- Un informe tiene como maximo una visita por vuelta (territorio).
create unique index if not exists territory_visits_report_round_unique
  on public.territory_visits (outing_report_id, territory_round_id)
  where outing_report_id is not null;
create index if not exists territory_visits_report_idx on public.territory_visits (outing_report_id) where outing_report_id is not null;

-- Visitas anteriores a V2: quien las cargo fue el propio conductor.
update public.territory_visits set submitted_by = conductor_id where submitted_by is null;

alter table public.outing_reports enable row level security;
revoke all on table public.outing_reports from anon, authenticated;

commit;


-- ============================================================
-- fase-10-s13-migration.sql
-- ============================================================
-- Fase 10: documentos S-13. La base de datos es la fuente de verdad: el S-13 se calcula
-- siempre desde territory_rounds/territory_visits; esta tabla solo define que documento
-- cubre que rango de territorios (y, mas adelante, el id del Google Doc real).
-- Aditiva e idempotente.

begin;

create table if not exists public.s13_documents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  first_territory integer not null check (first_territory > 0),
  last_territory integer not null,
  -- Se completa en la Fase 20 cuando se entreguen los Google Docs reales.
  external_document_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint s13_documents_range check (last_territory >= first_territory)
);

insert into public.s13_documents (code, title, first_territory, last_territory)
values
  ('S13_1_20', 'S-13 1-20 (Automatizado)', 1, 20),
  ('S13_21_36', 'S-13 21-36 (Automatizado)', 21, 36)
on conflict (code) do nothing;

alter table public.s13_documents enable row level security;
revoke all on table public.s13_documents from anon, authenticated;

commit;


-- ============================================================
-- fase-11-territory-map-migration.sql
-- ============================================================
-- Fase 11: mapa interactivo. La imagen del mapa (JPG) se mantiene como fondo y las formas de
-- territorios/manzanas son poligonos SVG con coordenadas normalizadas (0..1) sobre esa imagen,
-- asi escalan con cualquier tamano de pantalla. Aditiva e idempotente.

begin;

create table if not exists public.territory_map_layers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Ruta same-origin (p. ej. /maps/territorios.jpg dentro de public/) o URL https.
  image_url text not null,
  image_width integer,
  image_height integer,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_map_layers_name_not_blank check (length(btrim(name)) > 0),
  constraint territory_map_layers_image_url_safe check (image_url ~ '^(/[A-Za-z0-9_%.-][A-Za-z0-9_./%-]*|https://[^ ]+)$')
);

-- Un unico mapa activo a la vez.
create unique index if not exists one_active_territory_map_layer on public.territory_map_layers ((true)) where active;

create table if not exists public.territory_map_features (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.territory_map_layers(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  -- Nulo = forma del territorio completo; con valor = forma de esa manzana.
  block_id uuid references public.blocks(id) on delete cascade,
  points jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_map_features_points_shape check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 500)
);

create unique index if not exists territory_map_features_territory_unique
  on public.territory_map_features (layer_id, territory_id) where block_id is null;
create unique index if not exists territory_map_features_block_unique
  on public.territory_map_features (layer_id, block_id) where block_id is not null;

alter table public.territory_map_layers enable row level security;
alter table public.territory_map_features enable row level security;
revoke all on table public.territory_map_layers, public.territory_map_features from anon, authenticated;

commit;


-- ============================================================
-- fase-12-do-not-visit-migration.sql
-- ============================================================
-- Fase 12: direcciones "No visitar". Solo lo necesario: territorio, direccion, fecha agregada
-- y activo/inactivo. Quien lo cambia y cuando queda en audit_log. Aditiva e idempotente.

begin;

create table if not exists public.do_not_visit_addresses (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  address text not null,
  active boolean not null default true,
  -- Fecha agregada.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint do_not_visit_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists do_not_visit_territory_active_idx on public.do_not_visit_addresses (territory_id) where active;

alter table public.do_not_visit_addresses enable row level security;
revoke all on table public.do_not_visit_addresses from anon, authenticated;

commit;


-- ============================================================
-- fase-13-telephone-migration.sql
-- ============================================================
-- Fase 13: territorio telefonico y salidas por Zoom. Los telefonos pertenecen a los mismos
-- territorios; una salida por Zoom recibe un listado (snapshot) calculado al momento de
-- marcarla. Aditiva e idempotente.

begin;

create table if not exists public.territory_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  number text not null,
  -- Solo digitos: evita duplicar "11 4444-5555" y "1144445555" en el mismo territorio.
  number_key text not null,
  active boolean not null default true,
  -- Estado actual del numero = ultimo resultado registrado.
  activity text,
  last_activity_on date,
  last_conductor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_phone_numbers_activity_check check (activity is null or activity in ('NO_ABONADO', 'NO_SE_LLAMO', 'SE_LLAMO', 'NEGOCIO')),
  constraint territory_phone_numbers_number_not_blank check (length(btrim(number)) > 0 and length(number_key) >= 6),
  constraint territory_phone_numbers_unique unique (territory_id, number_key)
);

create index if not exists territory_phone_numbers_territory_idx on public.territory_phone_numbers (territory_id) where active;

alter table public.weekly_outing_slots add column if not exists is_zoom boolean not null default false;

-- Listado asignado a UNA salida (snapshot: no cambia si luego se agregan o quitan numeros).
create table if not exists public.telephone_assignments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.weekly_outing_slots(id) on delete cascade,
  primary_territory_id uuid references public.territories(id) on delete set null,
  territory_ids uuid[] not null default '{}',
  total integer not null default 0,
  minimum integer not null default 20,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.telephone_assignment_numbers (
  assignment_id uuid not null references public.telephone_assignments(id) on delete cascade,
  phone_number_id uuid not null references public.territory_phone_numbers(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  sort_order integer not null default 0,
  snapshot_number text not null,
  primary key (assignment_id, phone_number_id)
);

-- Historial de resultados: uno por (salida, numero); editar reemplaza la fila.
create table if not exists public.telephone_call_results (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_outing_slots(id) on delete cascade,
  phone_number_id uuid not null references public.territory_phone_numbers(id) on delete cascade,
  conductor_id uuid references public.profiles(id) on delete set null,
  activity text not null,
  called_on date not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telephone_call_results_activity_check check (activity in ('NO_ABONADO', 'NO_SE_LLAMO', 'SE_LLAMO', 'NEGOCIO')),
  constraint telephone_call_results_unique unique (slot_id, phone_number_id)
);

alter table public.territory_phone_numbers enable row level security;
alter table public.telephone_assignments enable row level security;
alter table public.telephone_assignment_numbers enable row level security;
alter table public.telephone_call_results enable row level security;
revoke all on table public.territory_phone_numbers, public.telephone_assignments, public.telephone_assignment_numbers, public.telephone_call_results from anon, authenticated;

commit;


-- ============================================================
-- fase-14-announcements-migration.sql
-- ============================================================
-- Fase 14: anuncios generales (avisos por lluvia, cambios, etc.). Los publican el Coordinador y
-- el Superintendente de Servicio; generan notificacion interna + push a cada usuario activo y
-- quedan visibles en la app. Se archivan, no se borran. Aditiva e idempotente.

begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  constraint announcements_title_not_blank check (length(btrim(title)) > 0),
  constraint announcements_description_not_blank check (length(btrim(description)) > 0)
);

create index if not exists announcements_visible_idx on public.announcements (created_at desc) where archived_at is null;

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;

commit;


-- ============================================================
-- fase-15-buildings-migration.sql
-- ============================================================
-- Fase 15: edificios. Pertenecen a UN territorio (no son una salida ni tienen conductor propio).
-- Cada edificio tiene su propia estructura de timbres/departamentos con identificadores de TEXTO
-- (A1, 2B, PB-A, 1°A...) organizados en una grilla, con version numerica para detectar conflictos.
-- Aditiva e idempotente. El proyecto externo de edificios se integrara despues por importacion.

begin;

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete restrict,
  address text not null,
  status text not null default 'ACTIVE',
  -- Sube en cada cambio de estructura; las correcciones se aplican solo sobre la version que vieron.
  structure_version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buildings_status_check check (status in ('ACTIVE', 'INACTIVE')),
  constraint buildings_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists buildings_territory_idx on public.buildings (territory_id) where status = 'ACTIVE';
create unique index if not exists buildings_territory_address_unique on public.buildings (territory_id, lower(btrim(address))) where status = 'ACTIVE';

create table if not exists public.building_units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  -- Texto libre: NO se asume un patron numerico.
  label text not null,
  row_index integer not null default 0,
  col_index integer not null default 0,
  -- Quitar un timbre lo desactiva (la actividad historica se conserva).
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_units_label_not_blank check (length(btrim(label)) > 0),
  constraint building_units_position_check check (row_index >= 0 and col_index >= 0)
);

create unique index if not exists building_units_label_unique on public.building_units (building_id, lower(btrim(label))) where active;
create unique index if not exists building_units_cell_unique on public.building_units (building_id, row_index, col_index) where active;

-- Historial de estructura: una fila por version.
create table if not exists public.building_versions (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  version integer not null,
  units jsonb not null,
  changed_by uuid references public.profiles(id) on delete set null,
  report_id uuid,
  created_at timestamptz not null default now(),
  constraint building_versions_unique unique (building_id, version)
);

-- Propuestas de edificio nuevo (las hace quien esta en la salida; las aprueba Servicio/Territorios).
create table if not exists public.building_proposals (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  address text not null,
  proposed_by uuid references public.profiles(id) on delete set null,
  status text not null default 'PENDING',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  building_id uuid references public.buildings(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint building_proposals_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  constraint building_proposals_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists building_proposals_pending_idx on public.building_proposals (created_at desc) where status = 'PENDING';

/**
 * Reemplaza la estructura de un edificio de forma ATOMICA sobre la version esperada.
 * p_units = [{ "id": uuid|null, "label": text, "row": int, "col": int }]:
 *  - con id existente: renombra/mueve (la actividad del timbre lo sigue);
 *  - sin id: timbre nuevo;
 *  - ausente: se desactiva (no se borra).
 * Si la version actual no es la esperada lanza VERSION_CONFLICT y no cambia nada.
 */
create or replace function public.replace_building_structure(
  p_building_id uuid,
  p_expected_version integer,
  p_units jsonb,
  p_actor uuid,
  p_report_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  current_version integer;
  new_version integer;
begin
  select structure_version into current_version from public.buildings where id = p_building_id for update;
  if current_version is null then
    raise exception 'BUILDING_NOT_FOUND';
  end if;
  if current_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  -- 1) Libera posiciones/etiquetas para evitar choques transitorios entre timbres que se intercambian.
  update public.building_units set row_index = row_index + 100000, label = '__tmp__' || id::text
  where building_id = p_building_id and active
    and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  -- 2) Existentes: aplica etiqueta/posicion.
  update public.building_units u
  set label = btrim(x.label), row_index = x.row, col_index = x.col, updated_at = now()
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where u.id = x.id and u.building_id = p_building_id and x.id is not null;

  -- 3) Ausentes: se desactivan.
  update public.building_units set active = false, updated_at = now()
  where building_id = p_building_id and active
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  -- 4) Nuevos.
  insert into public.building_units (building_id, label, row_index, col_index)
  select p_building_id, btrim(x.label), x.row, x.col
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where x.id is null;

  new_version := current_version + 1;
  update public.buildings set structure_version = new_version, updated_at = now() where id = p_building_id;
  insert into public.building_versions (building_id, version, units, changed_by, report_id)
  select p_building_id, new_version,
         coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'row', u.row_index, 'col', u.col_index) order by u.row_index, u.col_index), '[]'::jsonb),
         p_actor, p_report_id
  from public.building_units u where u.building_id = p_building_id and u.active;

  return new_version;
end;
$$;

revoke all on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) to service_role;

alter table public.buildings enable row level security;
alter table public.building_units enable row level security;
alter table public.building_versions enable row level security;
alter table public.building_proposals enable row level security;
revoke all on table public.buildings, public.building_units, public.building_versions, public.building_proposals from anon, authenticated;

commit;


-- ============================================================
-- fase-16-building-census-migration.sql
-- ============================================================
-- Fase 16: "Falta censar". Quien trabaja un territorio informa que a un edificio le faltan timbres,
-- el orden es incorrecto, cambio la numeracion u otro motivo (con foto y/o propuesta estructurada).
-- Servicio/Territorios aplican la correccion SOLO si el edificio sigue en la version que vio quien
-- informo; si cambio, hay conflicto y no se sobrescribe nada. Aditiva e idempotente.

begin;

create table if not exists public.building_census_reports (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  description text,
  -- Foto comprimida en el navegador (JPEG). Cuando exista Storage se migra a archivos.
  photo_data text,
  -- Propuesta estructurada opcional: [{"op":"ADD","label":"A3"},{"op":"RENAME","from":"2B","to":"2C"}, ...]
  diff jsonb,
  -- Version de la estructura que el usuario tenia delante al informar.
  base_version integer not null,
  status text not null default 'PENDING',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint building_census_reports_reason_check check (reason in ('FALTAN_TIMBRES', 'ORDEN_INCORRECTO', 'CAMBIO_NUMERACION', 'OTRO')),
  constraint building_census_reports_status_check check (status in ('PENDING', 'APPLIED', 'DISMISSED')),
  constraint building_census_reports_photo_check check (photo_data is null or (photo_data like 'data:image/jpeg;base64,%' and length(photo_data) <= 900000)),
  constraint building_census_reports_diff_check check (diff is null or (jsonb_typeof(diff) = 'array' and jsonb_array_length(diff) <= 50))
);

create index if not exists building_census_reports_pending_idx on public.building_census_reports (created_at) where status = 'PENDING';
create index if not exists building_census_reports_building_idx on public.building_census_reports (building_id, created_at desc);

-- Misma funcion de la Fase 15, ahora marcando la correccion como APLICADA dentro de la MISMA
-- transaccion (si algo falla, ni la estructura ni el reporte cambian).
create or replace function public.replace_building_structure(
  p_building_id uuid,
  p_expected_version integer,
  p_units jsonb,
  p_actor uuid,
  p_report_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  current_version integer;
  new_version integer;
begin
  select structure_version into current_version from public.buildings where id = p_building_id for update;
  if current_version is null then
    raise exception 'BUILDING_NOT_FOUND';
  end if;
  if current_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update public.building_units set row_index = row_index + 100000, label = '__tmp__' || id::text
  where building_id = p_building_id and active
    and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  update public.building_units u
  set label = btrim(x.label), row_index = x.row, col_index = x.col, updated_at = now()
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where u.id = x.id and u.building_id = p_building_id and x.id is not null;

  update public.building_units set active = false, updated_at = now()
  where building_id = p_building_id and active
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  insert into public.building_units (building_id, label, row_index, col_index)
  select p_building_id, btrim(x.label), x.row, x.col
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where x.id is null;

  new_version := current_version + 1;
  update public.buildings set structure_version = new_version, updated_at = now() where id = p_building_id;
  insert into public.building_versions (building_id, version, units, changed_by, report_id)
  select p_building_id, new_version,
         coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'row', u.row_index, 'col', u.col_index) order by u.row_index, u.col_index), '[]'::jsonb),
         p_actor, p_report_id
  from public.building_units u where u.building_id = p_building_id and u.active;

  if p_report_id is not null then
    update public.building_census_reports
    set status = 'APPLIED', decided_by = p_actor, decided_at = now()
    where id = p_report_id and building_id = p_building_id and status = 'PENDING';
    if not found then
      raise exception 'REPORT_NOT_PENDING';
    end if;
  end if;

  return new_version;
end;
$$;

revoke all on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) to service_role;

alter table public.building_census_reports enable row level security;
revoke all on table public.building_census_reports from anon, authenticated;

commit;


-- ============================================================
-- fase-17-building-activity-migration.sql
-- ============================================================
-- Fase 17: trabajo por departamento (timbre). Cada toque registra fecha, usuario, edificio y territorio.
--  * Atendio + mostro interes  -> REVISITA: cuenta como completado, queda accesible solo para quien la
--    marco (los demas la ven bloqueada y saben de quien es); el dueno puede quitarla y vuelve a estar libre.
--  * Atendio sin interes / no atendio -> TRABAJADO con bloqueo temporal (duracion configurable, no 30 dias fijos).
-- Nada se borra: deshacer marca la actividad como anulada y deja el historial. Aditiva e idempotente.

begin;

-- Configuracion del sistema (clave/valor). El tiempo de bloqueo se define aqui.
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value)
values ('building_lock', '{"amount": 1, "unit": "months"}'::jsonb)
on conflict (key) do nothing;

alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;

-- Vueltas de edificios (independientes del S-13). La logica de cierre llega en la Fase 18.
create table if not exists public.building_rounds (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  round_number integer not null,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint building_rounds_unique unique (building_id, round_number)
);

create unique index if not exists one_open_round_per_building on public.building_rounds (building_id) where closed_at is null;

create table if not exists public.building_unit_activity (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_id uuid not null references public.building_units(id) on delete cascade,
  round_id uuid references public.building_rounds(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  attended boolean not null,
  -- Solo tiene sentido si atendio.
  interested boolean,
  outcome text not null,
  worked_at timestamptz not null default now(),
  -- Fin del bloqueo temporal (nulo en una revisita: el bloqueo es la propiedad de quien la tiene).
  next_available_at timestamptz,
  revisit_active boolean not null default false,
  revisit_released_at timestamptz,
  revisit_released_by uuid references public.profiles(id) on delete set null,
  undone_at timestamptz,
  undone_by uuid references public.profiles(id) on delete set null,
  undo_reason text,
  unlocked_at timestamptz,
  unlocked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint building_unit_activity_outcome_check check (outcome in ('REVISITA', 'TRABAJADO')),
  constraint building_unit_activity_interest_check check (interested is null or attended),
  -- REVISITA si y solo si atendio y mostro interes.
  constraint building_unit_activity_revisit_check check ((outcome = 'REVISITA') = (attended and coalesce(interested, false)))
);

create index if not exists building_unit_activity_unit_idx on public.building_unit_activity (unit_id, worked_at desc);
create index if not exists building_unit_activity_building_round_idx on public.building_unit_activity (building_id, round_id);

alter table public.building_rounds enable row level security;
alter table public.building_unit_activity enable row level security;
revoke all on table public.building_rounds, public.building_unit_activity from anon, authenticated;

commit;


-- ============================================================
-- fase-19-personal-territories-migration.sql
-- ============================================================
-- Fase 19: territorio personal. Es una ASIGNACION (no un rol) de un territorio a una persona, en una
-- modalidad (casa en casa, telefonico o edificios), por periodos de 3 meses contados desde la fecha
-- de asignacion (15 sep -> 15 dic -> 15 mar), NO por trimestres de calendario.
-- Aditiva e idempotente.

begin;

create table if not exists public.personal_territory_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete restrict,
  mode text not null,
  -- Fecha de asignacion: ancla de todos los periodos (evita corrimientos por fines de mes).
  assigned_on date not null,
  period_index integer not null default 0,
  period_start date not null,
  period_end date not null,
  status text not null default 'ACTIVE',
  auto_renew boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  ended_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_territory_mode_check check (mode in ('CASA_EN_CASA', 'TELEFONICO', 'EDIFICIOS')),
  constraint personal_territory_status_check check (status in ('ACTIVE', 'ENDED')),
  constraint personal_territory_period_check check (period_end > period_start and period_index >= 0)
);

create unique index if not exists personal_territory_active_unique
  on public.personal_territory_assignments (profile_id, territory_id, mode) where status = 'ACTIVE';
create index if not exists personal_territory_due_idx on public.personal_territory_assignments (period_end) where status = 'ACTIVE';

create table if not exists public.personal_territory_reports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.personal_territory_assignments(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  notes text,
  -- Resumen segun la modalidad (manzanas, numeros llamados, timbres trabajados).
  summary jsonb not null default '{}'::jsonb,
  constraint personal_territory_reports_unique unique (assignment_id, period_start)
);

-- El informe reutiliza la logica de cada formulario: las visitas de casa en casa y los resultados
-- telefonicos apuntan a la asignacion en vez de a una salida.
alter table public.territory_visits
  add column if not exists personal_assignment_id uuid references public.personal_territory_assignments(id) on delete set null;

alter table public.telephone_call_results alter column slot_id drop not null;
alter table public.telephone_call_results
  add column if not exists personal_assignment_id uuid references public.personal_territory_assignments(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telephone_call_results_source_check') then
    alter table public.telephone_call_results
      add constraint telephone_call_results_source_check check (slot_id is not null or personal_assignment_id is not null);
  end if;
end $$;

create unique index if not exists telephone_call_results_personal_unique
  on public.telephone_call_results (personal_assignment_id, phone_number_id, called_on) where personal_assignment_id is not null;

alter table public.personal_territory_assignments enable row level security;
alter table public.personal_territory_reports enable row level security;
revoke all on table public.personal_territory_assignments, public.personal_territory_reports from anon, authenticated;

commit;


-- ============================================================
-- fase-20-s13-sync-migration.sql
-- ============================================================
-- Fase 20: integracion S-13 con Google Docs (preparada, NO activa). La base de datos sigue siendo la
-- fuente de verdad; el Doc es una representacion. Cada documento tiene un modo de sincronizacion:
--   DRY_RUN     (por defecto) calcula y registra que cambiaria, sin escribir en ningun lado;
--   STAGING     escribe solo en una COPIA de prueba (staging_document_id);
--   PRODUCTION  escribe en el documento real, solo tras verificar el staging.
-- Aditiva e idempotente.

begin;

alter table public.s13_documents
  add column if not exists staging_document_id text,
  add column if not exists sync_mode text not null default 'DRY_RUN',
  add column if not exists staging_verified_at timestamptz,
  add column if not exists last_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's13_documents_sync_mode_check') then
    alter table public.s13_documents
      add constraint s13_documents_sync_mode_check check (sync_mode in ('DRY_RUN', 'STAGING', 'PRODUCTION'));
  end if;
end $$;

-- Ultimo estado escrito con exito en el Doc (para enviar solo diferencias). Una fila por celda logica.
create table if not exists public.s13_sync_snapshots (
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  cell_key text not null,
  value text not null,
  synced_at timestamptz not null default now(),
  primary key (document_id, cell_key)
);

-- Cada intento de sincronizacion (incluidas las simulaciones).
create table if not exists public.s13_sync_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  mode text not null,
  status text not null default 'RUNNING',
  triggered_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text,
  constraint s13_sync_runs_status_check check (status in ('RUNNING', 'SIMULATED', 'SENT', 'FAILED', 'BLOCKED'))
);

-- Cambios pendientes/enviados de cada corrida (outbox): una fila por celda que cambia.
create table if not exists public.s13_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.s13_sync_runs(id) on delete cascade,
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  cell_key text not null,
  operation text not null,
  value text,
  status text not null default 'PENDING',
  last_error text,
  created_at timestamptz not null default now(),
  constraint s13_sync_outbox_operation_check check (operation in ('SET', 'CLEAR')),
  constraint s13_sync_outbox_status_check check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

create index if not exists s13_sync_runs_document_idx on public.s13_sync_runs (document_id, started_at desc);
create index if not exists s13_sync_outbox_run_idx on public.s13_sync_outbox (run_id);

alter table public.s13_sync_snapshots enable row level security;
alter table public.s13_sync_runs enable row level security;
alter table public.s13_sync_outbox enable row level security;
revoke all on table public.s13_sync_snapshots, public.s13_sync_runs, public.s13_sync_outbox from anon, authenticated;

commit;


-- ============================================================
-- fase-22-s13-pages-migration.sql
-- ============================================================
-- Fase 22: hojas del S-13. Cada "hoja" (4 rondas por territorio) es un Google Doc propio: la hoja 1 es el
-- documento original (s13_documents.external_document_id / staging_document_id); cuando a algun territorio
-- se le acaban las 4 rondas, el sistema COPIA la hoja anterior, la deja en blanco y sigue completando la
-- nueva. Esta tabla guarda el Doc de cada hoja >= 2, separado por destino (copia de prueba / real).
-- Tambien carga los IDs de los dos documentos reales. Sigue en modo DRY_RUN: no escribe nada por si sola.
-- Aditiva e idempotente. Requiere fase-10 y fase-20.

begin;

create table if not exists public.s13_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  page integer not null check (page >= 2),
  target text not null,
  google_document_id text not null,
  -- Se completa cuando la copia ya quedo en blanco (si falla a mitad, se reintenta).
  prepared_at timestamptz,
  created_at timestamptz not null default now(),
  constraint s13_document_pages_target_check check (target in ('STAGING', 'PRODUCTION')),
  unique (document_id, page, target)
);

alter table public.s13_document_pages enable row level security;
revoke all on table public.s13_document_pages from anon, authenticated;

-- Documentos reales entregados (solo si todavia no hay ninguno cargado).
update public.s13_documents set external_document_id = '1oP_nbrEeGYJddAZrzcIOe6t2A9jJAwVmj1oIfLNXk58', updated_at = now()
where code = 'S13_1_20' and external_document_id is null;
update public.s13_documents set external_document_id = '1Yr5dKQc1ADRYQDkUqcpug1zpDc1ryb7sJF5yC65t8S8', updated_at = now()
where code = 'S13_21_36' and external_document_id is null;

commit;


-- ===== fase-23-departure-point-kind.sql =====
-- Fase 23: tipo de punto de salida (Casa / Esquina). Aditiva: no borra ni modifica datos existentes.
-- Los puntos actuales quedan como ESQUINA (comportamiento anterior); marcá las casas desde
-- Salidas > Puntos de salida > Editar.
alter table public.departure_points
  add column if not exists kind text not null default 'ESQUINA';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'departure_points_kind_check'
  ) then
    alter table public.departure_points
      add constraint departure_points_kind_check check (kind in ('CASA', 'ESQUINA'));
  end if;
end $$;

-- ===== fase-24-group-designation.sql =====
-- Fase 24: designar un GRUPO en vez de un conductor.
--  - Conductores de fin de semana: cada sabado/domingo puede tener un conductor o un grupo.
--  - Conductores semanales (plantilla): cada fila puede tener un conductor fijo o un grupo fijo.
-- Aditiva: no borra ni modifica datos existentes (todas las filas actuales tienen conductor).

begin;

alter table public.weekend_roster
  alter column conductor_id drop not null;

alter table public.weekend_roster
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekend_roster_one_assignee') then
    alter table public.weekend_roster
      add constraint weekend_roster_one_assignee check ((conductor_id is not null) <> (group_id is not null));
  end if;
end $$;

alter table public.recurring_outing_slots
  add column if not exists default_group_id uuid references public.groups(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_outing_slots_one_assignee') then
    alter table public.recurring_outing_slots
      add constraint recurring_outing_slots_one_assignee check (default_conductor_id is null or default_group_id is null);
  end if;
end $$;

commit;
