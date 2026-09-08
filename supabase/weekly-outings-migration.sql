-- "Salidas semanales": planilla de Admin con horarios/conductor/lugar/territorios por dia,
-- de jueves a miercoles.

create table public.weekly_outings (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_outing_starts_thursday check (extract(isodow from starts_on) = 4)
);

create table public.weekly_outing_slots (
  id uuid primary key default gen_random_uuid(),
  weekly_outing_id uuid not null references public.weekly_outings(id) on delete cascade,
  slot_date date not null,
  sort_order integer not null default 0,
  hora text,
  lugar text,
  conductor_id uuid references public.profiles(id),
  highlighted boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_outing_slot_territories (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_outing_slots(id) on delete cascade,
  territory_id uuid not null references public.territories(id),
  territory_round_id uuid references public.territory_rounds(id),
  sort_order integer not null default 0,
  display_override text
);
