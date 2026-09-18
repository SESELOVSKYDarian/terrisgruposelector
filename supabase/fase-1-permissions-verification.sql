-- Read-only verification for the Fase 1 permission migration.
-- Run after the migration in staging/production; it does not print secrets.

select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.groups) as groups,
  (select count(*) from public.territories) as territories,
  (select count(*) from public.blocks) as blocks,
  (select count(*) from public.territory_reservations) as reservations,
  (select count(*) from public.weekly_outings) as weekly_outings,
  (select count(*) from public.territory_visits) as territory_visits,
  (select count(*) from public.territory_rounds) as territory_rounds;

select p.id, p.username
from public.profiles p
left join public.profile_appointments pa on pa.profile_id = p.id
where pa.profile_id is null;

select pr.profile_id, pr.responsibility
from public.profile_responsibilities pr
left join public.profile_appointments pa on pa.profile_id = pr.profile_id
left join public.profile_capabilities pc
  on pc.profile_id = pr.profile_id and pc.capability = 'CONDUCTOR' and pc.active
where pr.ended_at is null
  and (
    pa.appointment is null
    or (pr.responsibility in ('COORDINADOR', 'SUPERINTENDENTE_SERVICIO') and (pa.appointment <> 'ANCIANO' or pc.id is null))
    or (pr.responsibility = 'SIERVO_TERRITORIOS' and pa.appointment not in ('ANCIANO', 'SIERVO_MINISTERIAL'))
  );

select gra.group_id, gra.responsibility, gra.profile_id
from public.group_responsibility_assignments gra
left join public.profile_appointments pa on pa.profile_id = gra.profile_id
where gra.ended_at is null
  and (
    pa.appointment is null
    or (gra.responsibility = 'SUPERINTENDENTE_GRUPO' and pa.appointment <> 'ANCIANO')
    or (gra.responsibility = 'AUXILIAR_GRUPO' and pa.appointment not in ('ANCIANO', 'SIERVO_MINISTERIAL'))
  );
