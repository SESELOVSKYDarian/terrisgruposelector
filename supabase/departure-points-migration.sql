-- Puntos de salida: casas de hermanos / lugares, opcionalmente asociados a un territorio
-- como sugerencia de lugar al armar Salidas semanales.

create table public.departure_points (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  territory_id uuid references public.territories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
