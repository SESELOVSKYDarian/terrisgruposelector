-- Historial de asignaciones por territorio (ciclo conductor -> fecha asignada -> fecha completada),
-- independiente de la "vuelta anual" global que ya usan los Ancianos para reservar.

create table public.territory_rounds (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  conductor_id uuid not null references public.profiles(id),
  assigned_on date not null,
  completed_on date,
  pending_block_labels text[] not null default '{}',
  done_block_labels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- solo puede haber UNA vuelta abierta por territorio a la vez
create unique index one_open_round_per_territory
  on public.territory_rounds(territory_id)
  where completed_on is null;

create table public.territory_visits (
  id uuid primary key default gen_random_uuid(),
  territory_round_id uuid not null references public.territory_rounds(id) on delete cascade,
  conductor_id uuid not null references public.profiles(id),
  visit_date date not null,
  done_labels text[] not null default '{}',
  pending_labels text[] not null default '{}',
  created_at timestamptz not null default now()
);
