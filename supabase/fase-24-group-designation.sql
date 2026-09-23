-- Fase 24: designar un GRUPO en vez de un conductor.
--  - Conductores de fin de semana: cada sabado/domingo puede tener un conductor o un grupo.
--  - Conductores semanales (plantilla): cada fila puede tener un conductor fijo o un grupo fijo.
-- Aditiva: no borra ni modifica datos existentes (todas las filas actuales tienen conductor).

begin;

alter table public.weekend_roster
  alter column conductor_id drop not null;

alter table public.weekend_roster
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekend_roster_one_assignee') then
    alter table public.weekend_roster
      add constraint weekend_roster_one_assignee check ((conductor_id is not null) <> (group_id is not null));
  end if;
end $$;

alter table public.recurring_outing_slots
  add column if not exists default_group_id uuid references public.groups(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_outing_slots_one_assignee') then
    alter table public.recurring_outing_slots
      add constraint recurring_outing_slots_one_assignee check (default_conductor_id is null or default_group_id is null);
  end if;
end $$;

commit;
