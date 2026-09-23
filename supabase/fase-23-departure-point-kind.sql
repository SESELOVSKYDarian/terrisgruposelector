-- Fase 23: tipo de punto de salida (Casa / Esquina). Aditiva: no borra ni modifica datos existentes.
-- Los puntos actuales quedan como ESQUINA (comportamiento anterior); marcá las casas desde
-- Salidas > Puntos de salida > Editar.
alter table public.departure_points
  add column if not exists kind text not null default 'ESQUINA';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'departure_points_kind_check'
  ) then
    alter table public.departure_points
      add constraint departure_points_kind_check check (kind in ('CASA', 'ESQUINA'));
  end if;
end $$;
