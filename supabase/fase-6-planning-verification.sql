-- Verificacion post-migracion de Fase 6 (solo lectura).

-- 1) Ninguna semana preexistente se perdio; todas tienen estado valido.
select status, count(*) as weeks from public.weekly_outings group by status order by status;

-- 2) Cobertura del backfill de horas: PARSED / EMPTY / UNPARSEABLE.
select time_parse_status, count(*) as slots from public.weekly_outing_slots group by time_parse_status order by time_parse_status;

-- 3) Horas que requieren revision manual.
select i.slot_id, i.hora, s.slot_date, i.reason
from public.weekly_outing_time_backfill_issues i
join public.weekly_outing_slots s on s.id = i.slot_id
order by s.slot_date;

-- 4) starts_at coherente con slot_date (hora de Buenos Aires) en filas PARSED: debe dar 0.
select count(*) as mismatched
from public.weekly_outing_slots
where time_parse_status = 'PARSED'
  and (starts_at at time zone 'America/Argentina/Buenos_Aires')::date <> slot_date;

-- 5) Paridad con el parser TypeScript (tests/outings-workflow.test.ts): todo debe ser true.
select
  public.parse_outing_time('18:30') = time '18:30' as ok_hhmm,
  public.parse_outing_time('18.30') = time '18:30' as ok_dot,
  public.parse_outing_time('18h30') = time '18:30' as ok_h,
  public.parse_outing_time('18 hs') = time '18:00' as ok_hs,
  public.parse_outing_time('9 am') = time '09:00' as ok_am,
  public.parse_outing_time('9:15 p.m.') = time '21:15' as ok_pm,
  public.parse_outing_time('12 am') = time '00:00' as ok_midnight,
  public.parse_outing_time('25:00') is null as ok_reject_hour,
  public.parse_outing_time('9 a 11') is null as ok_reject_range,
  public.parse_outing_time('Zoom') is null as ok_reject_text;
