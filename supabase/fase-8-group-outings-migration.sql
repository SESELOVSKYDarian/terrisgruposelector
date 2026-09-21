-- Fase 8: Salida por Grupo. La "ventana" sigue siendo reservation_windows; cada grupo
-- responde una vez por fecha (lugar obligatorio, conductor, hora, territorios) y esa
-- respuesta alimenta automaticamente la planificacion semanal y las reservas/bloqueos.
-- Aditiva e idempotente: no toca reservas ni ventanas existentes.

begin;

create table if not exists public.group_outing_responses (
  id uuid primary key default gen_random_uuid(),
  reservation_window_id uuid not null references public.reservation_windows(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  service_date date not null,
  lugar text not null,
  conductor_id uuid references public.profiles(id) on delete set null,
  -- "HH:MM" (America/Argentina/Buenos_Aires); el instante real vive en la fila de planificacion.
  hora text,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint group_outing_responses_lugar_not_blank check (length(btrim(lugar)) > 0),
  constraint group_outing_responses_hora_format check (hora is null or hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint group_outing_responses_weekend check (extract(isodow from service_date) in (6, 7)),
  constraint group_outing_responses_unique unique (reservation_window_id, group_id, service_date)
);

create index if not exists group_outing_responses_window_idx on public.group_outing_responses (reservation_window_id, service_date);

-- Los territorios de la respuesta son sus reservas: asi se reutilizan los bloqueos existentes.
alter table public.territory_reservations
  add column if not exists group_response_id uuid references public.group_outing_responses(id) on delete set null;
create index if not exists territory_reservations_group_response_idx on public.territory_reservations (group_response_id) where group_response_id is not null;

-- La respuesta genera (y luego mantiene) exactamente una fila de planificacion.
alter table public.weekly_outing_slots
  add column if not exists group_id uuid references public.groups(id) on delete set null,
  add column if not exists group_response_id uuid references public.group_outing_responses(id) on delete set null;
create unique index if not exists weekly_outing_slots_group_response_unique
  on public.weekly_outing_slots (group_response_id) where group_response_id is not null;

alter table public.group_outing_responses enable row level security;
revoke all on table public.group_outing_responses from anon, authenticated;

commit;
