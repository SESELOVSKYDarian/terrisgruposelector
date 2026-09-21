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
