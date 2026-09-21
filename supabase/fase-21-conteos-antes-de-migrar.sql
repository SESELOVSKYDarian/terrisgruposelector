-- Fase 21: conteos de tus datos reales. SOLO LECTURA. Ejecutalo ANTES de aplicar las migraciones V2 y
-- guarda el resultado; despues vuelve a ejecutarlo y compara: las filas deben ser IGUALES.
-- Funciona con el esquema viejo y con el nuevo. Devuelve un unico resultado (una fila por tabla).
-- Si una tabla no existe muestra "no existe" en lugar de fallar.

select
  t.name as tabla,
  case
    when to_regclass('public.' || t.name) is null then 'no existe'
    else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.name), false, true, '')))[1]::text
  end as filas
from (values
  ('profiles'), ('profile_roles'), ('groups'), ('territories'), ('blocks'),
  ('reservation_windows'), ('territory_reservations'), ('territory_rounds'), ('territory_visits'),
  ('weekly_outings'), ('weekly_outing_slots'), ('weekly_outing_slot_territories'),
  ('weekend_roster'), ('departure_points')
) as t(name)
order by t.name;
