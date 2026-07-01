create extension if not exists "pgcrypto";

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  alter column id set default gen_random_uuid();

alter table public.profiles
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists group_id uuid references public.groups(id) on delete set null,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_updated_at timestamptz not null default now();

update public.profiles
set username = lower(replace(full_name, ' ', ''))
where username is null;

alter table public.profiles
  alter column username set not null;

create unique index if not exists profiles_username_key
  on public.profiles(username);

alter table public.annual_rounds
  drop constraint if exists annual_rounds_year_key;

drop index if exists public.one_open_round_per_year;

alter table public.annual_rounds
  add column if not exists name text;

update public.annual_rounds
set name = 'Vuelta ' || year::text
where name is null or trim(name) = '';

alter table public.annual_rounds
  alter column name set not null;

alter table public.territories
  alter column name set default '';

update public.territories
set name = ''
where name is null;

create table if not exists public.reservation_windows (
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

alter table public.territory_reservations
  add column if not exists reservation_window_id uuid references public.reservation_windows(id) on delete cascade,
  add column if not exists departure_location text,
  add column if not exists reserved_by_admin boolean not null default false,
  add column if not exists admin_note text;

alter table public.territory_reservations
  alter column group_id drop not null;

drop index if exists public.one_active_group_reservation_per_window_date;

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.territory_reservations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

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

drop trigger if exists reopen_reservation_lock_after_update
  on public.territory_reservations;

create trigger reopen_reservation_lock_after_update
after update of status on public.territory_reservations
for each row execute function public.reopen_reservation_lock();

-- La aplicacion usa API routes con SUPABASE_SERVICE_ROLE_KEY y cookie HttpOnly.
-- RLS queda activo para impedir que el navegador acceda directo con la anon key.
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
