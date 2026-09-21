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
