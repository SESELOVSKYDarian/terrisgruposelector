create extension if not exists "pgcrypto";

create type public.app_role as enum ('ADMIN', 'ANCIANO');
create type public.round_status as enum ('OPEN', 'CLOSED');
create type public.block_status as enum (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'NEEDS_FOLLOW_UP',
  'BLOCKED'
);
create type public.service_day as enum ('SATURDAY', 'SUNDAY');
create type public.reservation_status as enum (
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);
create type public.lock_source as enum (
  'RESERVATION',
  'FOLLOW_UP',
  'MANUAL'
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  full_name text not null,
  group_id uuid references public.groups(id) on delete set null,
  role public.app_role not null default 'ANCIANO',
  active boolean not null default true,
  must_change_password boolean not null default false,
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number > 0),
  name text not null default '',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  label text not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (territory_id, label)
);

create table public.annual_rounds (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  name text not null,
  status public.round_status not null default 'OPEN',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  constraint closed_round_has_closed_at check (
    (status = 'CLOSED' and closed_at is not null)
    or (status = 'OPEN' and closed_at is null)
  )
);

create table public.block_round_statuses (
  id uuid primary key default gen_random_uuid(),
  annual_round_id uuid not null references public.annual_rounds(id) on delete cascade,
  block_id uuid not null references public.blocks(id) on delete cascade,
  status public.block_status not null default 'PENDING',
  notes text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (annual_round_id, block_id)
);

create table public.reservation_windows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  saturday_date date,
  sunday_date date,
  booking_deadline timestamptz not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_window_has_date check (
    saturday_date is not null or sunday_date is not null
  ),
  constraint reservation_window_saturday check (
    saturday_date is null or extract(isodow from saturday_date) = 6
  ),
  constraint reservation_window_sunday check (
    sunday_date is null or extract(isodow from sunday_date) = 7
  )
);

create table public.territory_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_window_id uuid not null references public.reservation_windows(id) on delete cascade,
  territory_id uuid not null references public.territories(id),
  group_id uuid not null references public.groups(id),
  responsible_user_id uuid not null references public.profiles(id),
  service_date date not null,
  service_day public.service_day not null,
  status public.reservation_status not null default 'ACTIVE',
  departure_location text not null,
  notes text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint reservation_is_weekend check (
    extract(isodow from service_date) in (6, 7)
  ),
  constraint service_day_matches_date check (
    (service_day = 'SATURDAY' and extract(isodow from service_date) = 6)
    or (service_day = 'SUNDAY' and extract(isodow from service_date) = 7)
  )
);

create unique index one_active_reservation_per_territory_date
  on public.territory_reservations(territory_id, service_date)
  where status = 'ACTIVE';

create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.territory_reservations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.territory_locks (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  source public.lock_source not null,
  reservation_id uuid references public.territory_reservations(id) on delete cascade,
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.profiles(id),
  constraint reservation_lock_has_reservation check (
    source <> 'RESERVATION' or reservation_id is not null
  )
);

create unique index one_active_manual_lock_per_territory
  on public.territory_locks(territory_id, source)
  where active = true and source in ('FOLLOW_UP', 'MANUAL');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select null::public.app_role
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'ADMIN'
$$;

create or replace function public.is_elder_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('ADMIN', 'ANCIANO')
$$;

create or replace function public.create_reservation_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ACTIVE' then
    insert into public.territory_locks (
      territory_id,
      source,
      reservation_id,
      reason,
      created_by
    )
    values (
      new.territory_id,
      'RESERVATION',
      new.id,
      'Reserva activa para ' || new.service_date::text,
      new.created_by
    );
  end if;

  return new;
end;
$$;

create or replace function public.resolve_reservation_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED', 'EXPIRED') then
    update public.territory_locks
      set active = false,
          resolved_at = now()
      where reservation_id = new.id
        and active = true;
  end if;

  return new;
end;
$$;

create or replace function public.reopen_reservation_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'ACTIVE' and new.status = 'ACTIVE' then
    insert into public.territory_locks (
      territory_id,
      source,
      reservation_id,
      reason,
      created_by
    )
    values (
      new.territory_id,
      'RESERVATION',
      new.id,
      'Reserva reabierta para ' || new.service_date::text,
      new.created_by
    );
  end if;

  return new;
end;
$$;

create trigger create_reservation_lock_after_insert
after insert on public.territory_reservations
for each row execute function public.create_reservation_lock();

create trigger resolve_reservation_lock_after_update
after update of status on public.territory_reservations
for each row execute function public.resolve_reservation_lock();

create trigger reopen_reservation_lock_after_update
after update of status on public.territory_reservations
for each row execute function public.reopen_reservation_lock();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.territories enable row level security;
alter table public.blocks enable row level security;
alter table public.annual_rounds enable row level security;
alter table public.block_round_statuses enable row level security;
alter table public.reservation_windows enable row level security;
alter table public.territory_reservations enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.territory_locks enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read own and admins"
on public.profiles for select
using (false);

create policy "profiles admin manage"
on public.profiles for all
using (false)
with check (false);

create policy "catalog read elder admin"
on public.groups for select
using (public.is_elder_or_admin());

create policy "groups admin manage"
on public.groups for all
using (public.is_admin())
with check (public.is_admin());

create policy "territories read elder admin"
on public.territories for select
using (public.is_elder_or_admin());

create policy "territories admin manage"
on public.territories for all
using (public.is_admin())
with check (public.is_admin());

create policy "blocks read elder admin"
on public.blocks for select
using (public.is_elder_or_admin());

create policy "blocks admin manage"
on public.blocks for all
using (public.is_admin())
with check (public.is_admin());

create policy "rounds read elder admin"
on public.annual_rounds for select
using (public.is_elder_or_admin());

create policy "rounds admin manage"
on public.annual_rounds for all
using (public.is_admin())
with check (public.is_admin());

create policy "block status read elder admin"
on public.block_round_statuses for select
using (public.is_elder_or_admin());

create policy "block status update elder admin"
on public.block_round_statuses for update
using (public.is_elder_or_admin())
with check (public.is_elder_or_admin());

create policy "block status admin insert"
on public.block_round_statuses for insert
with check (public.is_admin());

create policy "windows read elder admin"
on public.reservation_windows for select
using (public.is_elder_or_admin());

create policy "windows admin manage"
on public.reservation_windows for all
using (public.is_admin())
with check (public.is_admin());

create policy "reservations read elder admin"
on public.territory_reservations for select
using (public.is_elder_or_admin());

create policy "reservations elder admin insert"
on public.territory_reservations for insert
with check (public.is_elder_or_admin());

create policy "reservations elder admin update"
on public.territory_reservations for update
using (public.is_elder_or_admin())
with check (public.is_elder_or_admin());

create policy "locks read elder admin"
on public.territory_locks for select
using (public.is_elder_or_admin());

create policy "locks admin manage"
on public.territory_locks for all
using (public.is_admin())
with check (public.is_admin());

create policy "audit admin read"
on public.audit_logs for select
using (public.is_admin());

create policy "notifications admin manage"
on public.admin_notifications for all
using (public.is_admin())
with check (public.is_admin());
