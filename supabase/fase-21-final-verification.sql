-- Fase 21: verificacion final (solo lectura). Ejecutala DOS veces: antes de aplicar las migraciones V2
-- (los bloques 1 y 2 deben funcionar igual con el esquema viejo) y despues, y compara los conteos.
-- No imprime secretos ni datos personales.

-- 1) CONTEOS de los datos reales que deben conservarse (deben ser IGUALES antes y despues).
select 'profiles' as tabla, count(*) as filas from public.profiles
union all select 'profile_roles', count(*) from public.profile_roles
union all select 'groups', count(*) from public.groups
union all select 'territories', count(*) from public.territories
union all select 'blocks', count(*) from public.blocks
union all select 'reservation_windows', count(*) from public.reservation_windows
union all select 'territory_reservations', count(*) from public.territory_reservations
union all select 'territory_rounds', count(*) from public.territory_rounds
union all select 'territory_visits', count(*) from public.territory_visits
union all select 'weekly_outings', count(*) from public.weekly_outings
union all select 'weekly_outing_slots', count(*) from public.weekly_outing_slots
union all select 'weekly_outing_slot_territories', count(*) from public.weekly_outing_slot_territories
union all select 'weekend_roster', count(*) from public.weekend_roster
union all select 'departure_points', count(*) from public.departure_points
order by 1;

-- 2) ESTADO de los datos preexistentes tras migrar: las semanas viejas quedan PUBLISHED y las horas
--    se interpretan o se listan (nunca se descartan).
select status, count(*) as semanas from public.weekly_outings group by status order by status;
select time_parse_status, count(*) as salidas from public.weekly_outing_slots group by time_parse_status order by time_parse_status;

-- 3) EXISTEN todas las tablas V2 (todo debe dar true).
select t.name as tabla, to_regclass('public.' || t.name) is not null as existe
from (values
  ('profile_appointments'), ('profile_capabilities'), ('profile_responsibilities'), ('group_responsibility_assignments'),
  ('domain_events'), ('user_notifications'), ('event_deliveries'), ('push_subscriptions'), ('scheduled_jobs'),
  ('audit_log'), ('recurring_outing_slots'), ('group_outing_responses'), ('outing_reports'),
  ('s13_documents'), ('s13_sync_snapshots'), ('s13_sync_runs'), ('s13_sync_outbox'),
  ('territory_map_layers'), ('territory_map_features'), ('do_not_visit_addresses'),
  ('territory_phone_numbers'), ('telephone_assignments'), ('telephone_assignment_numbers'), ('telephone_call_results'),
  ('announcements'), ('buildings'), ('building_units'), ('building_versions'), ('building_proposals'),
  ('building_census_reports'), ('system_settings'), ('building_rounds'), ('building_unit_activity'),
  ('personal_territory_assignments'), ('personal_territory_reports')
) as t(name)
order by 2, 1;

-- 4) INVARIANTES (cada consulta debe devolver 0 filas / 0).
-- 4a) Perfiles sin condicion V2 (deben tener exactamente una).
select count(*) as perfiles_sin_condicion_v2 from public.profiles p
where not exists (select 1 from public.profile_appointments a where a.profile_id = p.id);

-- 4b) Mas de una vuelta abierta por territorio.
select count(*) as territorios_con_varias_vueltas_abiertas from (
  select territory_id from public.territory_rounds where completed_on is null group by territory_id having count(*) > 1
) x;

-- 4c) Salidas con conductor que no es conductor (ni capacidad V2 ni rol legacy).
select count(*) as salidas_con_conductor_invalido from public.weekly_outing_slots s
where s.conductor_id is not null
  and not exists (select 1 from public.profile_capabilities c where c.profile_id = s.conductor_id and c.capability = 'CONDUCTOR' and c.active)
  and not exists (select 1 from public.profile_roles r where r.profile_id = s.conductor_id and r.role in ('CONDUCTOR', 'ADMIN'));

-- 4d) Respuestas de grupo sin fila de planificacion generada.
select count(*) as respuestas_sin_salida from public.group_outing_responses r
where not exists (select 1 from public.weekly_outing_slots s where s.group_response_id = r.id);

-- 4e) Edificios activos sin ningun timbre activo (informativo: falta censar).
select count(*) as edificios_sin_timbres from public.buildings b
where b.status = 'ACTIVE' and not exists (select 1 from public.building_units u where u.building_id = b.id and u.active);

-- 4f) Mas de una vuelta abierta por edificio.
select count(*) as edificios_con_varias_vueltas_abiertas from (
  select building_id from public.building_rounds where closed_at is null group by building_id having count(*) > 1
) x;

-- 4g) Asignaciones personales activas con periodo incoherente.
select count(*) as asignaciones_personales_incoherentes from public.personal_territory_assignments
where status = 'ACTIVE' and period_end <= period_start;

-- 4h) Notificaciones internas de mas de 30 dias (el borrado es oportunista: informativo).
select count(*) as notificaciones_vencidas from public.user_notifications where created_at < now() - interval '30 days';

-- 4i) Modo de sincronizacion S-13: ninguno debe estar en PRODUCTION sin staging verificado.
select count(*) as s13_produccion_sin_staging_verificado from public.s13_documents
where sync_mode = 'PRODUCTION' and staging_verified_at is null;
