-- Fase 15: edificios. Pertenecen a UN territorio (no son una salida ni tienen conductor propio).
-- Cada edificio tiene su propia estructura de timbres/departamentos con identificadores de TEXTO
-- (A1, 2B, PB-A, 1°A...) organizados en una grilla, con version numerica para detectar conflictos.
-- Aditiva e idempotente. El proyecto externo de edificios se integrara despues por importacion.

begin;

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete restrict,
  address text not null,
  status text not null default 'ACTIVE',
  -- Sube en cada cambio de estructura; las correcciones se aplican solo sobre la version que vieron.
  structure_version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buildings_status_check check (status in ('ACTIVE', 'INACTIVE')),
  constraint buildings_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists buildings_territory_idx on public.buildings (territory_id) where status = 'ACTIVE';
create unique index if not exists buildings_territory_address_unique on public.buildings (territory_id, lower(btrim(address))) where status = 'ACTIVE';

create table if not exists public.building_units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  -- Texto libre: NO se asume un patron numerico.
  label text not null,
  row_index integer not null default 0,
  col_index integer not null default 0,
  -- Quitar un timbre lo desactiva (la actividad historica se conserva).
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint building_units_label_not_blank check (length(btrim(label)) > 0),
  constraint building_units_position_check check (row_index >= 0 and col_index >= 0)
);

create unique index if not exists building_units_label_unique on public.building_units (building_id, lower(btrim(label))) where active;
create unique index if not exists building_units_cell_unique on public.building_units (building_id, row_index, col_index) where active;

-- Historial de estructura: una fila por version.
create table if not exists public.building_versions (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  version integer not null,
  units jsonb not null,
  changed_by uuid references public.profiles(id) on delete set null,
  report_id uuid,
  created_at timestamptz not null default now(),
  constraint building_versions_unique unique (building_id, version)
);

-- Propuestas de edificio nuevo (las hace quien esta en la salida; las aprueba Servicio/Territorios).
create table if not exists public.building_proposals (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  address text not null,
  proposed_by uuid references public.profiles(id) on delete set null,
  status text not null default 'PENDING',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  building_id uuid references public.buildings(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint building_proposals_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  constraint building_proposals_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists building_proposals_pending_idx on public.building_proposals (created_at desc) where status = 'PENDING';

/**
 * Reemplaza la estructura de un edificio de forma ATOMICA sobre la version esperada.
 * p_units = [{ "id": uuid|null, "label": text, "row": int, "col": int }]:
 *  - con id existente: renombra/mueve (la actividad del timbre lo sigue);
 *  - sin id: timbre nuevo;
 *  - ausente: se desactiva (no se borra).
 * Si la version actual no es la esperada lanza VERSION_CONFLICT y no cambia nada.
 */
create or replace function public.replace_building_structure(
  p_building_id uuid,
  p_expected_version integer,
  p_units jsonb,
  p_actor uuid,
  p_report_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  current_version integer;
  new_version integer;
begin
  select structure_version into current_version from public.buildings where id = p_building_id for update;
  if current_version is null then
    raise exception 'BUILDING_NOT_FOUND';
  end if;
  if current_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  -- 1) Libera posiciones/etiquetas para evitar choques transitorios entre timbres que se intercambian.
  update public.building_units set row_index = row_index + 100000, label = '__tmp__' || id::text
  where building_id = p_building_id and active
    and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  -- 2) Existentes: aplica etiqueta/posicion.
  update public.building_units u
  set label = btrim(x.label), row_index = x.row, col_index = x.col, updated_at = now()
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where u.id = x.id and u.building_id = p_building_id and x.id is not null;

  -- 3) Ausentes: se desactivan.
  update public.building_units set active = false, updated_at = now()
  where building_id = p_building_id and active
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  -- 4) Nuevos.
  insert into public.building_units (building_id, label, row_index, col_index)
  select p_building_id, btrim(x.label), x.row, x.col
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where x.id is null;

  new_version := current_version + 1;
  update public.buildings set structure_version = new_version, updated_at = now() where id = p_building_id;
  insert into public.building_versions (building_id, version, units, changed_by, report_id)
  select p_building_id, new_version,
         coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'row', u.row_index, 'col', u.col_index) order by u.row_index, u.col_index), '[]'::jsonb),
         p_actor, p_report_id
  from public.building_units u where u.building_id = p_building_id and u.active;

  return new_version;
end;
$$;

revoke all on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) to service_role;

alter table public.buildings enable row level security;
alter table public.building_units enable row level security;
alter table public.building_versions enable row level security;
alter table public.building_proposals enable row level security;
revoke all on table public.buildings, public.building_units, public.building_versions, public.building_proposals from anon, authenticated;

commit;
