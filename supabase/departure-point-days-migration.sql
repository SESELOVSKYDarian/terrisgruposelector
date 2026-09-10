-- Dias de la semana (ISO: 1=lunes .. 7=domingo) en que se puede salir desde cada punto.
-- Array vacio = sin definir (cualquier dia), igual que el comportamiento actual.
alter table departure_points add column if not exists available_days integer[] not null default '{}'::integer[];
