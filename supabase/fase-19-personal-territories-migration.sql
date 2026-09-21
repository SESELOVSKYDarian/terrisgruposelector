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
