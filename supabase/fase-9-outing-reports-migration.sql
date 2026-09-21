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
