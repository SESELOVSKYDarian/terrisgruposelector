-- Fase 21: verificacion final. SOLO LECTURA. Ejecutala DESPUES de aplicar todas las migraciones V2
-- (fase-1 ... fase-22, en el orden de docs/PR_TERRITORIOS_V2_MASTER_PLAN.md). Devuelve UN solo resultado con una fila por chequeo:
--   estado = OK             el chequeo paso;
--   estado = REVISAR        hay algo para mirar (ver "valor");
--   estado = FALTA MIGRAR   la tabla/columna todavia no existe: aplica la migracion que corresponde;
--   estado = INFO           dato informativo (no es un error).
-- Los conteos "datos ..." deben ser IGUALES a los que guardaste con fase-21-conteos-antes-de-migrar.sql.
-- No imprime secretos ni datos personales.

with
tablas(nombre) as (values
  ('profile_appointments'), ('profile_capabilities'), ('profile_responsibilities'), ('group_responsibility_assignments'),
  ('domain_events'), ('user_notifications'), ('event_deliveries'), ('push_subscriptions'), ('scheduled_jobs'),
  ('audit_log'), ('recurring_outing_slots'), ('group_outing_responses'), ('outing_reports'),
  ('s13_documents'), ('s13_sync_snapshots'), ('s13_sync_runs'), ('s13_sync_outbox'), ('s13_document_pages'),
  ('territory_map_layers'), ('territory_map_features'), ('do_not_visit_addresses'),
  ('territory_phone_numbers'), ('telephone_assignments'), ('telephone_assignment_numbers'), ('telephone_call_results'),
  ('announcements'), ('buildings'), ('building_units'), ('building_versions'), ('building_proposals'),
  ('building_census_reports'), ('system_settings'), ('building_rounds'), ('building_unit_activity'),
  ('personal_territory_assignments'), ('personal_territory_reports')
),
datos(nombre) as (values
  ('profiles'), ('profile_roles'), ('groups'), ('territories'), ('blocks'),
  ('reservation_windows'), ('territory_reservations'), ('territory_rounds'), ('territory_visits'),
  ('weekly_outings'), ('weekly_outing_slots'), ('weekly_outing_slot_territories'),
  ('weekend_roster'), ('departure_points')
),
-- (etiqueta, tabla, columna que solo existe tras migrar, SQL que debe devolver un numero (0 = correcto))
invariantes(etiqueta, tabla, columna, consulta) as (values
  ('perfiles sin condicion V2', 'profile_appointments', 'profile_id',
    'select count(*) from public.profiles p where not exists (select 1 from public.profile_appointments a where a.profile_id = p.id)'),
  ('territorios con varias vueltas abiertas', 'territory_rounds', 'completed_on',
    'select count(*) from (select territory_id from public.territory_rounds where completed_on is null group by territory_id having count(*) > 1) x'),
  ('salidas con conductor que no es conductor', 'profile_capabilities', 'capability',
    'select count(*) from public.weekly_outing_slots s where s.conductor_id is not null and not exists (select 1 from public.profile_capabilities c where c.profile_id = s.conductor_id and c.capability = ''CONDUCTOR'' and c.active) and not exists (select 1 from public.profile_roles r where r.profile_id = s.conductor_id and r.role in (''CONDUCTOR'', ''ADMIN''))'),
  ('respuestas de grupo sin salida generada', 'weekly_outing_slots', 'group_response_id',
    'select count(*) from public.group_outing_responses r where not exists (select 1 from public.weekly_outing_slots s where s.group_response_id = r.id)'),
  ('edificios con varias vueltas abiertas', 'building_rounds', 'closed_at',
    'select count(*) from (select building_id from public.building_rounds where closed_at is null group by building_id having count(*) > 1) x'),
  ('asignaciones personales con periodo incoherente', 'personal_territory_assignments', 'period_end',
    'select count(*) from public.personal_territory_assignments where status = ''ACTIVE'' and period_end <= period_start'),
  ('S-13 en PRODUCTION sin staging verificado', 's13_documents', 'sync_mode',
    'select count(*) from public.s13_documents where sync_mode = ''PRODUCTION'' and staging_verified_at is null'),
  ('semanas sin estado de planificacion', 'weekly_outings', 'status',
    'select count(*) from public.weekly_outings where status is null'),
  ('salidas con hora que no se pudo interpretar', 'weekly_outing_slots', 'time_parse_status',
    'select count(*) from public.weekly_outing_slots where time_parse_status = ''UNPARSEABLE''')
),
informativos(etiqueta, tabla, columna, consulta) as (values
  ('edificios activos sin timbres (falta censar)', 'buildings', 'status',
    'select count(*) from public.buildings b where b.status = ''ACTIVE'' and not exists (select 1 from public.building_units u where u.building_id = b.id and u.active)'),
  ('notificaciones de mas de 30 dias (se borran solas)', 'user_notifications', 'created_at',
    'select count(*) from public.user_notifications where created_at < now() - interval ''30 days''')
)

select 1 as orden, 'datos ' || d.nombre as chequeo,
  case when to_regclass('public.' || d.nombre) is null then null
       else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', d.nombre), false, true, '')))[1]::text::bigint end as valor,
  case when to_regclass('public.' || d.nombre) is null then 'FALTA MIGRAR' else 'INFO' end as estado
from datos d

union all
select 2, 'existe ' || t.nombre,
  (to_regclass('public.' || t.nombre) is not null)::int::bigint,
  case when to_regclass('public.' || t.nombre) is not null then 'OK' else 'FALTA MIGRAR' end
from tablas t

union all
select 3, 'invariante: ' || i.etiqueta,
  case when c.existe then (xpath('/row/c/text()', query_to_xml(format('select (%s) as c', i.consulta), false, true, '')))[1]::text::bigint end,
  case
    when not c.existe then 'FALTA MIGRAR'
    when (xpath('/row/c/text()', query_to_xml(format('select (%s) as c', i.consulta), false, true, '')))[1]::text::bigint = 0 then 'OK'
    else 'REVISAR'
  end
from invariantes i
cross join lateral (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = i.tabla and column_name = i.columna) as existe
) c

union all
select 4, 'info: ' || f.etiqueta,
  case when c.existe then (xpath('/row/c/text()', query_to_xml(format('select (%s) as c', f.consulta), false, true, '')))[1]::text::bigint end,
  case when c.existe then 'INFO' else 'FALTA MIGRAR' end
from informativos f
cross join lateral (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = f.tabla and column_name = f.columna) as existe
) c

order by 1, 2;
