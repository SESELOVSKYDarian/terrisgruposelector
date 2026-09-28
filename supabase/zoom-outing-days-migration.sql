-- Dias de la semana (ISO: 1=lunes .. 7=domingo) en que la salida es por Zoom de forma predefinida:
-- al autocompletar la semana se asigna el listado telefonico de los territorios mas atrasados.
-- Aditiva e idempotente.
create table if not exists public.zoom_outing_days (
  iso_weekday smallint primary key check (iso_weekday between 1 and 7),
  hora text,
  created_at timestamptz not null default now()
);
alter table public.zoom_outing_days enable row level security;
revoke all on table public.zoom_outing_days from anon, authenticated;
