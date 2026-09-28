-- Carga unica de la planilla de vueltas (28/09/2026). YA APLICADO en produccion.
-- Se deja como registro; es idempotente (volver a correrlo deja el mismo resultado).
--
-- Por cada territorio: ultima vuelta hecha (8, 9 o 10), ultima fecha completado y manzanas que faltan.
--  * Vuelta 8  -> ronda "Vuelta 8"
--  * Vuelta 9  -> ronda "Campaña Septiembre" (se cierra: faltan 10, 20, 1 y 14)
--  * Vuelta 10 -> ronda nueva "Vuelta 10 - Asamblea Regional" (queda abierta y pasa a ser la activa)
-- Manzanas que faltan = PENDING en esa ronda; el resto = COMPLETED con la fecha de la planilla.
-- Respaldo previo: backup_20260928_annual_rounds y backup_20260928_block_round_statuses (solo lectura, sin acceso publico).
-- Verifica que la ultima fecha de cada territorio coincida con la planilla; si no, deshace todo.

create table if not exists public.backup_20260928_annual_rounds as select * from public.annual_rounds;
create table if not exists public.backup_20260928_block_round_statuses as select * from public.block_round_statuses;
alter table public.backup_20260928_annual_rounds enable row level security;
alter table public.backup_20260928_block_round_statuses enable row level security;
revoke all on table public.backup_20260928_annual_rounds from anon, authenticated;
revoke all on table public.backup_20260928_block_round_statuses from anon, authenticated;

do $import$
declare
  r8 uuid; r9 uuid; r10 uuid;
  n_upd int; mismatches int;
begin
  select id into strict r8 from public.annual_rounds where year = 2026 and name = 'Vuelta 8';
  select id into strict r9 from public.annual_rounds where year = 2026 and name = 'Campaña Septiembre';
  select id into r10 from public.annual_rounds where year = 2026 and name = 'Vuelta 10 - Asamblea Regional';
  if r10 is null then
    insert into public.annual_rounds (year, name) values (2026, 'Vuelta 10 - Asamblea Regional') returning id into r10;
    insert into public.block_round_statuses (annual_round_id, block_id, status) select r10, id, 'PENDING' from public.blocks where active;
  end if;

  create temp table _plan (territory int, last_round int, missing int[], last_date date) on commit drop;
  insert into _plan values
    (10,8,'{1}','2026-08-18'),(20,8,'{3,4}','2026-08-23'),(1,8,'{2,3}','2026-08-29'),(14,8,'{}','2026-09-01'),
    (17,9,'{}','2026-09-01'),(25,9,'{4}','2026-09-01'),(8,9,'{}','2026-09-03'),(33,9,'{}','2026-09-03'),
    (15,9,'{}','2026-09-06'),(19,9,'{}','2026-09-06'),(3,9,'{}','2026-09-08'),(6,9,'{}','2026-09-10'),
    (22,9,'{}','2026-09-10'),(27,9,'{3,4}','2026-09-10'),(32,9,'{}','2026-09-10'),(34,9,'{}','2026-09-13'),
    (18,9,'{2,3,4}','2026-09-15'),(12,9,'{}','2026-09-17'),(23,9,'{}','2026-09-17'),(30,9,'{}','2026-09-17'),
    (35,9,'{}','2026-09-18'),(36,9,'{}','2026-09-18'),(28,9,'{}','2026-09-19'),(29,9,'{}','2026-09-19'),
    (2,9,'{}','2026-09-20'),(4,9,'{}','2026-09-20'),(5,9,'{}','2026-09-22'),(9,9,'{}','2026-09-22'),
    (7,9,'{}','2026-09-24'),(11,9,'{}','2026-09-24'),(13,9,'{}','2026-09-24'),(16,9,'{}','2026-09-24'),
    (26,10,'{}','2026-09-26'),(31,10,'{}','2026-09-26'),(21,10,'{}','2026-09-27'),(24,10,'{}','2026-09-27');

  with target as (
    select case p.last_round when 8 then r8 when 9 then r9 else r10 end as round_id, b.id as block_id,
           regexp_replace(b.label, '\D', '', 'g')::int as num, p.last_date, p.missing
    from _plan p join public.territories t on t.number = p.territory
    join public.blocks b on b.territory_id = t.id and b.active
  )
  update public.block_round_statuses s
  set status = case when t.num = any(t.missing) then 'PENDING'::public.block_status else 'COMPLETED'::public.block_status end,
      completed_on = case when t.num = any(t.missing) then null else t.last_date end,
      updated_at = now()
  from target t where s.annual_round_id = t.round_id and s.block_id = t.block_id;
  get diagnostics n_upd = row_count;

  update public.annual_rounds set status = 'CLOSED', closed_at = coalesce(closed_at, now()) where id = r9 and status = 'OPEN';

  select count(*) into mismatches
  from _plan p join public.territories t on t.number = p.territory
  where p.last_date is distinct from (
    select max(s.completed_on) from public.block_round_statuses s join public.blocks b on b.id = s.block_id
    where b.territory_id = t.id and s.status = 'COMPLETED');

  if n_upd <> 148 or mismatches <> 0 then
    raise exception 'Verificacion fallida, se deshace todo: % filas actualizadas, % fechas distintas', n_upd, mismatches;
  end if;
end
$import$;
