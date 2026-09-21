-- Fase 11: mapa interactivo. La imagen del mapa (JPG) se mantiene como fondo y las formas de
-- territorios/manzanas son poligonos SVG con coordenadas normalizadas (0..1) sobre esa imagen,
-- asi escalan con cualquier tamano de pantalla. Aditiva e idempotente.

begin;

create table if not exists public.territory_map_layers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Ruta same-origin (p. ej. /maps/territorios.jpg dentro de public/) o URL https.
  image_url text not null,
  image_width integer,
  image_height integer,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_map_layers_name_not_blank check (length(btrim(name)) > 0),
  constraint territory_map_layers_image_url_safe check (image_url ~ '^(/[A-Za-z0-9_%.-][A-Za-z0-9_./%-]*|https://[^ ]+)$')
);

-- Un unico mapa activo a la vez.
create unique index if not exists one_active_territory_map_layer on public.territory_map_layers ((true)) where active;

create table if not exists public.territory_map_features (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.territory_map_layers(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  -- Nulo = forma del territorio completo; con valor = forma de esa manzana.
  block_id uuid references public.blocks(id) on delete cascade,
  points jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territory_map_features_points_shape check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 500)
);

create unique index if not exists territory_map_features_territory_unique
  on public.territory_map_features (layer_id, territory_id) where block_id is null;
create unique index if not exists territory_map_features_block_unique
  on public.territory_map_features (layer_id, block_id) where block_id is not null;

alter table public.territory_map_layers enable row level security;
alter table public.territory_map_features enable row level security;
revoke all on table public.territory_map_layers, public.territory_map_features from anon, authenticated;

commit;
