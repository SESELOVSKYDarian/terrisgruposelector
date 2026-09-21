-- Fase 6: workflow de planificacion semanal (DRAFT -> IN_REVIEW -> PUBLISHED),
-- estados de salida, timestamps reales (America/Argentina/Buenos_Aires) y auditoria.
-- Es aditiva e idempotente: no borra ni reescribe datos existentes. Las semanas que
-- ya existian quedan como PUBLISHED (eran el plan operativo vigente).

begin;

-- ---------------------------------------------------------------------------
-- Auditoria generica (las fases siguientes la extienden, no la reemplazan).
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_blank check (length(trim(action)) > 0),
  constraint audit_log_entity_type_not_blank check (length(trim(entity_type)) > 0)
);

create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Workflow de la planificacion (semana).
-- ---------------------------------------------------------------------------
alter table public.weekly_outings add column if not exists status text not null default 'PUBLISHED';
alter table public.weekly_outings add column if not exists submitted_at timestamptz;
alter table public.weekly_outings add column if not exists submitted_by uuid references public.profiles(id) on delete set null;
alter table public.weekly_outings add column if not exists approved_at timestamptz;
alter table public.weekly_outings add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.weekly_outings add column if not exists published_at timestamptz;
alter table public.weekly_outings add column if not exists published_by uuid references public.profiles(id) on delete set null;

-- Filas previas: ya eran el plan vigente. Filas nuevas empiezan como borrador.
update public.weekly_outings set published_at = coalesce(published_at, created_at) where status = 'PUBLISHED' and published_at is null;
alter table public.weekly_outings alter column status set default 'DRAFT';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_outings_status_check') then
    alter table public.weekly_outings
      add constraint weekly_outings_status_check check (status in ('DRAFT', 'IN_REVIEW', 'PUBLISHED'));
  end if;
end $$;

create index if not exists weekly_outings_status_starts_idx on public.weekly_outings (status, starts_on desc);

-- ---------------------------------------------------------------------------
-- Estado por salida + timestamp real.
-- ---------------------------------------------------------------------------
alter table public.weekly_outing_slots add column if not exists status text not null default 'PROGRAMADA';
alter table public.weekly_outing_slots add column if not exists starts_at timestamptz;
alter table public.weekly_outing_slots add column if not exists time_parse_status text;
alter table public.weekly_outing_slots add column if not exists cancelled_at timestamptz;
alter table public.weekly_outing_slots add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_outing_slots_status_check') then
    alter table public.weekly_outing_slots
      add constraint weekly_outing_slots_status_check check (status in ('PROGRAMADA', 'REALIZADA', 'CANCELADA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'weekly_outing_slots_time_parse_status_check') then
    alter table public.weekly_outing_slots
      add constraint weekly_outing_slots_time_parse_status_check check (time_parse_status in ('PARSED', 'EMPTY', 'UNPARSEABLE'));
  end if;
end $$;

create index if not exists weekly_outing_slots_starts_at_idx on public.weekly_outing_slots (starts_at);

-- Espejo SQL de src/modules/outings/time.ts (parseOutingTime). Acepta "18:30", "18.30",
-- "18h30", "18 hs", "9 am", "9:15 p.m."; cualquier otra cosa devuelve null (no se adivina).
create or replace function public.parse_outing_time(raw text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  h integer;
  mi integer;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  m := regexp_match(lower(btrim(raw)), '^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:(a\.?\s?m\.?|p\.?\s?m\.?)|hs?\.?|hrs?\.?|horas?)?$');
  if m is null then
    return null;
  end if;
  h := m[1]::integer;
  mi := coalesce(m[2]::integer, 0);
  if mi > 59 then
    return null;
  end if;
  if m[3] is not null then
    if h < 1 or h > 12 then
      return null;
    end if;
    if m[3] like 'p%' and h < 12 then
      h := h + 12;
    elsif m[3] like 'a%' and h = 12 then
      h := 0;
    end if;
  elsif h > 23 then
    return null;
  end if;
  return make_time(h, mi, 0);
end;
$$;

-- El trigger es la unica fuente de verdad de starts_at: cubre la UI legacy y la V2.
create or replace function public.sync_weekly_outing_slot_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parsed time;
begin
  parsed := public.parse_outing_time(new.hora);
  if new.hora is null or btrim(new.hora) = '' then
    new.time_parse_status := 'EMPTY';
    new.starts_at := null;
  elsif parsed is null then
    new.time_parse_status := 'UNPARSEABLE';
    new.starts_at := null;
  else
    new.time_parse_status := 'PARSED';
    new.starts_at := (new.slot_date + parsed) at time zone 'America/Argentina/Buenos_Aires';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_outing_slots_sync_time on public.weekly_outing_slots;
create trigger weekly_outing_slots_sync_time
before insert or update of hora, slot_date on public.weekly_outing_slots
for each row execute function public.sync_weekly_outing_slot_time();

-- Filas que no se pudieron interpretar: se listan, no se descartan ni se corrompen.
create table if not exists public.weekly_outing_time_backfill_issues (
  slot_id uuid primary key references public.weekly_outing_slots(id) on delete cascade,
  hora text,
  reason text not null,
  detected_at timestamptz not null default now()
);

alter table public.weekly_outing_time_backfill_issues enable row level security;
revoke all on table public.weekly_outing_time_backfill_issues from anon, authenticated;

-- Backfill idempotente: `update of hora` dispara el trigger aunque el valor no cambie.
update public.weekly_outing_slots set hora = hora where time_parse_status is null;

insert into public.weekly_outing_time_backfill_issues (slot_id, hora, reason)
select id, hora, 'hora en texto libre que no coincide con un formato horario reconocido'
from public.weekly_outing_slots
where time_parse_status = 'UNPARSEABLE'
on conflict (slot_id) do nothing;

revoke all on function public.parse_outing_time(text) from public, anon, authenticated;
revoke all on function public.sync_weekly_outing_slot_time() from public, anon, authenticated;
grant execute on function public.parse_outing_time(text) to service_role;
grant execute on function public.sync_weekly_outing_slot_time() to service_role;

commit;
