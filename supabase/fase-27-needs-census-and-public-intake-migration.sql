-- Fase 27: estado "falta censar" a nivel edificio + altas/informes que llegan desde el sitio publico (PHP).
--  * buildings.needs_census: el edificio existe pero faltan timbres o estan mal censados.
--  * building_proposals: ahora puede venir sin territorio (quien informa desde la web no siempre lo sabe;
--    lo asigna Servicio/Territorios al aprobar), con foto de los timbres y cantidad de timbres declarada.
--  * source: de donde vino el informe/propuesta (APP o WEB). Aditiva e idempotente.

begin;

alter table public.buildings add column if not exists needs_census boolean not null default false;

alter table public.building_proposals alter column territory_id drop not null;
alter table public.building_proposals add column if not exists photo_data text;
alter table public.building_proposals add column if not exists unit_count integer;
alter table public.building_proposals add column if not exists source text not null default 'APP';
alter table public.building_census_reports add column if not exists source text not null default 'APP';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'building_proposals_photo_check') then
    alter table public.building_proposals add constraint building_proposals_photo_check check (photo_data is null or (photo_data like 'data:image/jpeg;base64,%' and length(photo_data) <= 900000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'building_proposals_unit_count_check') then
    alter table public.building_proposals add constraint building_proposals_unit_count_check check (unit_count is null or unit_count >= 6);
  end if;
end
$$;

commit;
