-- Fase 25: capa de textos y zonas del mapa propio del sistema (nombres de calles, titulo, zona de deportes).
-- Aditiva e idempotente. Coordenadas normalizadas 0..1 sobre el mapa; el tamano de letra es una fraccion del ancho.
begin;

create table if not exists public.territory_map_labels (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.territory_map_layers(id) on delete cascade,
  kind text not null default 'LABEL' check (kind in ('LABEL', 'AREA')),
  text text,
  x numeric,
  y numeric,
  rotation numeric not null default 0,
  size numeric not null default 0.01,
  bold boolean not null default false,
  tone text not null default 'street' check (tone in ('street', 'zone', 'title')),
  points jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_map_labels_shape check (
    (kind = 'LABEL' and text is not null and x is not null and y is not null)
    or (kind = 'AREA' and points is not null and jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 500)
  )
);

alter table public.territory_map_labels enable row level security;
revoke all on table public.territory_map_labels from anon, authenticated;

commit;

-- Posicion del circulo numerado de cada territorio sobre el mapa (0..1). El numero que muestra sale del territorio.
create table if not exists public.territory_map_badges (
  layer_id uuid not null references public.territory_map_layers(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  primary key (layer_id, territory_id)
);
alter table public.territory_map_badges enable row level security;
revoke all on table public.territory_map_badges from anon, authenticated;
