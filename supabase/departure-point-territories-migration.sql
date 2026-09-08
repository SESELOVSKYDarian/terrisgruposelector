-- Un punto de salida puede tener varios territorios cercanos asociados, en orden
-- de mas cercano a mas lejano. Reemplaza la relacion 1:1 (departure_points.territory_id).

create table public.departure_point_territories (
  id uuid primary key default gen_random_uuid(),
  departure_point_id uuid not null references public.departure_points(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  sort_order integer not null default 0,
  unique (departure_point_id, territory_id)
);

-- migrar la asociacion 1:1 existente a la nueva tabla
insert into public.departure_point_territories (departure_point_id, territory_id, sort_order)
select id, territory_id, 0 from public.departure_points where territory_id is not null;

alter table public.departure_points drop column territory_id;
