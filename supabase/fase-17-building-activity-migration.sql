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
