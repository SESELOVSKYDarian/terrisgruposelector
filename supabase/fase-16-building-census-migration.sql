-- Fase 16: "Falta censar". Quien trabaja un territorio informa que a un edificio le faltan timbres,
-- el orden es incorrecto, cambio la numeracion u otro motivo (con foto y/o propuesta estructurada).
-- Servicio/Territorios aplican la correccion SOLO si el edificio sigue en la version que vio quien
-- informo; si cambio, hay conflicto y no se sobrescribe nada. Aditiva e idempotente.

begin;

create table if not exists public.building_census_reports (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  description text,
  -- Foto comprimida en el navegador (JPEG). Cuando exista Storage se migra a archivos.
  photo_data text,
  -- Propuesta estructurada opcional: [{"op":"ADD","label":"A3"},{"op":"RENAME","from":"2B","to":"2C"}, ...]
  diff jsonb,
  -- Version de la estructura que el usuario tenia delante al informar.
  base_version integer not null,
  status text not null default 'PENDING',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint building_census_reports_reason_check check (reason in ('FALTAN_TIMBRES', 'ORDEN_INCORRECTO', 'CAMBIO_NUMERACION', 'OTRO')),
  constraint building_census_reports_status_check check (status in ('PENDING', 'APPLIED', 'DISMISSED')),
  constraint building_census_reports_photo_check check (photo_data is null or (photo_data like 'data:image/jpeg;base64,%' and length(photo_data) <= 900000)),
  constraint building_census_reports_diff_check check (diff is null or (jsonb_typeof(diff) = 'array' and jsonb_array_length(diff) <= 50))
);

create index if not exists building_census_reports_pending_idx on public.building_census_reports (created_at) where status = 'PENDING';
create index if not exists building_census_reports_building_idx on public.building_census_reports (building_id, created_at desc);

-- Misma funcion de la Fase 15, ahora marcando la correccion como APLICADA dentro de la MISMA
-- transaccion (si algo falla, ni la estructura ni el reporte cambian).
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

  update public.building_units set row_index = row_index + 100000, label = '__tmp__' || id::text
  where building_id = p_building_id and active
    and id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

  update public.building_units u
  set label = btrim(x.label), row_index = x.row, col_index = x.col, updated_at = now()
  from jsonb_to_recordset(p_units) as x(id uuid, label text, row integer, col integer)
  where u.id = x.id and u.building_id = p_building_id and x.id is not null;

  update public.building_units set active = false, updated_at = now()
  where building_id = p_building_id and active
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_units) x where x ->> 'id' is not null);

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

  if p_report_id is not null then
    update public.building_census_reports
    set status = 'APPLIED', decided_by = p_actor, decided_at = now()
    where id = p_report_id and building_id = p_building_id and status = 'PENDING';
    if not found then
      raise exception 'REPORT_NOT_PENDING';
    end if;
  end if;

  return new_version;
end;
$$;

revoke all on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_building_structure(uuid, integer, jsonb, uuid, uuid) to service_role;

alter table public.building_census_reports enable row level security;
revoke all on table public.building_census_reports from anon, authenticated;

commit;
