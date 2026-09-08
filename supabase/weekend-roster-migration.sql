-- Roster de conductores de fin de semana: un conductor asignado por fecha
-- concreta (sabado o domingo), usado como sugerencia al armar Salidas semanales.

create table public.weekend_roster (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  conductor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekend_roster_is_weekend check (extract(isodow from service_date) in (6, 7))
);
