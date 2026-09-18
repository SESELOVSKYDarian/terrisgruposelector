-- Fase 1: modelo V2 de nombramientos, características y responsabilidades.
-- Esta migración es estrictamente aditiva. No modifica ni elimina los roles legacy.
-- Aplicar después de las migraciones existentes, en una copia/staging antes de producción.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_appointment_kind') then
    create type public.profile_appointment_kind as enum ('ANCIANO', 'SIERVO_MINISTERIAL', 'PUBLICADOR');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_capability_kind') then
    create type public.profile_capability_kind as enum ('CONDUCTOR', 'PRECURSOR');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'profile_responsibility_kind') then
    create type public.profile_responsibility_kind as enum (
      'COORDINADOR',
      'SUPERINTENDENTE_SERVICIO',
      'SIERVO_TERRITORIOS',
      'SUPERINTENDENTE_GRUPO',
      'AUXILIAR_GRUPO'
    );
  end if;
end
$$;

alter table public.profiles
  add column if not exists v2_permissions_backfilled_at timestamptz,
  add column if not exists v2_permissions_backfill_source text;

create table if not exists public.profile_appointments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  appointment public.profile_appointment_kind not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.assert_v2_exactly_one_appointment(target_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- A deleted profile no longer needs an appointment; ON DELETE CASCADE is
  -- therefore compatible with this deferred invariant.
  if not exists (select 1 from public.profiles where id = target_profile_id) then
    return;
  end if;

  if (select count(*) from public.profile_appointments where profile_id = target_profile_id) <> 1 then
    raise exception 'Cada perfil debe tener exactamente un nombramiento V2.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_v2_profile_appointment_count()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.assert_v2_exactly_one_appointment(coalesce(new.profile_id, old.profile_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_v2_new_profile_appointment_count()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.assert_v2_exactly_one_appointment(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create table if not exists public.profile_capabilities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  capability public.profile_capability_kind not null,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint profile_capabilities_revocation_matches_active check (
    (active and revoked_at is null) or (not active and revoked_at is not null)
  ),
  unique (profile_id, capability)
);

-- Keeps the V2 invariant for accounts created while the V1 user form still
-- writes profiles.role. Legacy role changes are intentionally not mirrored:
-- V2 becomes the source of truth for all new permission-management routes.
create or replace function public.ensure_v2_profile_appointment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.profile_appointments (profile_id, appointment)
  values (
    new.id,
    case
      when new.role in ('ADMIN', 'ANCIANO') then 'ANCIANO'::public.profile_appointment_kind
      when new.role = 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
      else 'PUBLICADOR'::public.profile_appointment_kind
    end
  )
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_v2_profile_appointment_after_insert on public.profiles;
create trigger ensure_v2_profile_appointment_after_insert
after insert on public.profiles
for each row execute function public.ensure_v2_profile_appointment();

drop trigger if exists enforce_v2_profile_appointment_count on public.profile_appointments;
create constraint trigger enforce_v2_profile_appointment_count
after insert or update or delete on public.profile_appointments
deferrable initially deferred
for each row execute function public.enforce_v2_profile_appointment_count();

drop trigger if exists enforce_v2_new_profile_appointment_count on public.profiles;
create constraint trigger enforce_v2_new_profile_appointment_count
after insert or delete on public.profiles
deferrable initially deferred
for each row execute function public.enforce_v2_new_profile_appointment_count();

create table if not exists public.profile_responsibilities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  responsibility public.profile_responsibility_kind not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_responsibilities_only_global check (
    responsibility in ('COORDINADOR', 'SUPERINTENDENTE_SERVICIO', 'SIERVO_TERRITORIOS')
  ),
  constraint profile_responsibilities_dates check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists profile_responsibilities_one_active_per_profile_kind
  on public.profile_responsibilities(profile_id, responsibility)
  where ended_at is null;

create table if not exists public.group_responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  responsibility public.profile_responsibility_kind not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_responsibility_assignments_only_group check (
    responsibility in ('SUPERINTENDENTE_GRUPO', 'AUXILIAR_GRUPO')
  ),
  constraint group_responsibility_assignments_dates check (ended_at is null or ended_at >= assigned_at)
);

create unique index if not exists group_responsibility_assignments_one_active_per_group_kind
  on public.group_responsibility_assignments(group_id, responsibility)
  where ended_at is null;

create index if not exists group_responsibility_assignments_profile_active_idx
  on public.group_responsibility_assignments(profile_id)
  where ended_at is null;

create table if not exists public.permission_audit_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  source text not null,
  legacy_roles jsonb not null default '[]'::jsonb,
  appointment public.profile_appointment_kind,
  capabilities jsonb not null default '[]'::jsonb,
  global_responsibilities jsonb not null default '[]'::jsonb,
  group_responsibilities jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists permission_audit_snapshots_profile_captured_idx
  on public.permission_audit_snapshots(profile_id, captured_at desc);

-- These functions are trigger-only guards. They run with the caller's rights,
-- use a fixed search path, and are not exposed for direct API execution.
create or replace function public.assert_v2_responsibility_eligibility(
  target_profile_id uuid,
  target_responsibility public.profile_responsibility_kind
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_appointment public.profile_appointment_kind;
  has_driver_capability boolean;
begin
  select appointment into current_appointment
  from public.profile_appointments
  where profile_id = target_profile_id;

  select exists(
    select 1
    from public.profile_capabilities
    where profile_id = target_profile_id
      and capability = 'CONDUCTOR'
      and active
  ) into has_driver_capability;

  if current_appointment is null then
    raise exception 'El perfil debe tener un nombramiento V2 antes de asignar una responsabilidad.'
      using errcode = '23514';
  end if;

  if target_responsibility in ('COORDINADOR', 'SUPERINTENDENTE_SERVICIO')
    and not (current_appointment = 'ANCIANO' and has_driver_capability) then
    raise exception 'La responsabilidad % requiere ANCIANO y CONDUCTOR.', target_responsibility
      using errcode = '23514';
  end if;

  if target_responsibility = 'SUPERINTENDENTE_GRUPO'
    and current_appointment <> 'ANCIANO' then
    raise exception 'SUPERINTENDENTE_GRUPO requiere ANCIANO.' using errcode = '23514';
  end if;

  if target_responsibility in ('SIERVO_TERRITORIOS', 'AUXILIAR_GRUPO')
    and current_appointment not in ('ANCIANO', 'SIERVO_MINISTERIAL') then
    raise exception 'La responsabilidad % requiere ANCIANO o SIERVO_MINISTERIAL.', target_responsibility
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.validate_v2_global_responsibility()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.ended_at is null then
    perform public.assert_v2_responsibility_eligibility(new.profile_id, new.responsibility);
  end if;
  return new;
end;
$$;

create or replace function public.validate_v2_group_responsibility()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.ended_at is null then
    perform public.assert_v2_responsibility_eligibility(new.profile_id, new.responsibility);
  end if;
  return new;
end;
$$;

create or replace function public.prevent_v2_permission_dependency_break()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  responsibility_row record;
begin
  for responsibility_row in
    select profile_id, responsibility
    from public.profile_responsibilities
    where profile_id = new.profile_id and ended_at is null
    union all
    select profile_id, responsibility
    from public.group_responsibility_assignments
    where profile_id = new.profile_id and ended_at is null
  loop
    perform public.assert_v2_responsibility_eligibility(
      responsibility_row.profile_id,
      responsibility_row.responsibility
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_v2_global_responsibility_before_write on public.profile_responsibilities;
create trigger validate_v2_global_responsibility_before_write
before insert or update of profile_id, responsibility, ended_at on public.profile_responsibilities
for each row execute function public.validate_v2_global_responsibility();

drop trigger if exists validate_v2_group_responsibility_before_write on public.group_responsibility_assignments;
create trigger validate_v2_group_responsibility_before_write
before insert or update of profile_id, responsibility, ended_at on public.group_responsibility_assignments
for each row execute function public.validate_v2_group_responsibility();

drop trigger if exists prevent_v2_appointment_dependency_break on public.profile_appointments;
create trigger prevent_v2_appointment_dependency_break
after update of appointment on public.profile_appointments
for each row execute function public.prevent_v2_permission_dependency_break();

drop trigger if exists prevent_v2_capability_dependency_break on public.profile_capabilities;
create trigger prevent_v2_capability_dependency_break
after update of active on public.profile_capabilities
for each row execute function public.prevent_v2_permission_dependency_break();

-- Capture the legacy state before mapping it. The snapshot is append-only from
-- the migration's perspective and gives operators a review record without
-- altering profiles.role or profile_roles.
insert into public.permission_audit_snapshots (
  profile_id,
  source,
  legacy_roles,
  appointment,
  capabilities,
  global_responsibilities,
  metadata
)
select
  p.id,
  'fase-1-backfill',
  legacy.legacy_roles,
  case
    when legacy.legacy_roles ? 'ADMIN' or legacy.legacy_roles ? 'ANCIANO' then 'ANCIANO'::public.profile_appointment_kind
    when legacy.legacy_roles ? 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
    else 'PUBLICADOR'::public.profile_appointment_kind
  end,
  case when legacy.legacy_roles ? 'ADMIN' or legacy.legacy_roles ? 'CONDUCTOR' then '["CONDUCTOR"]'::jsonb else '[]'::jsonb end,
  case when legacy.legacy_roles ? 'ADMIN' then '["COORDINADOR"]'::jsonb else '[]'::jsonb end,
  jsonb_build_object('legacy_profile_role', p.role::text)
from public.profiles p
cross join lateral (
  select coalesce(jsonb_agg(distinct role), '[]'::jsonb) || case
    when p.role is null then '[]'::jsonb else jsonb_build_array(p.role::text)
  end as legacy_roles
  from public.profile_roles
  where profile_id = p.id
) legacy
where not exists (
  select 1 from public.permission_audit_snapshots snapshot
  where snapshot.profile_id = p.id and snapshot.source = 'fase-1-backfill'
);

insert into public.profile_appointments (profile_id, appointment)
select
  p.id,
  case
    when exists (select 1 from public.profile_roles pr where pr.profile_id = p.id and pr.role in ('ADMIN', 'ANCIANO'))
      or p.role in ('ADMIN', 'ANCIANO') then 'ANCIANO'::public.profile_appointment_kind
    when exists (select 1 from public.profile_roles pr where pr.profile_id = p.id and pr.role = 'PUBLICADOR')
      or p.role = 'PUBLICADOR' then 'PUBLICADOR'::public.profile_appointment_kind
    else 'PUBLICADOR'::public.profile_appointment_kind
  end
from public.profiles p
on conflict (profile_id) do nothing;

insert into public.profile_capabilities (profile_id, capability, active)
select p.id, 'CONDUCTOR'::public.profile_capability_kind, true
from public.profiles p
where p.role = 'ADMIN'
   or exists (
     select 1 from public.profile_roles pr
     where pr.profile_id = p.id and pr.role in ('ADMIN', 'CONDUCTOR')
   )
on conflict (profile_id, capability) do nothing;

insert into public.profile_responsibilities (profile_id, responsibility)
select p.id, 'COORDINADOR'::public.profile_responsibility_kind
from public.profiles p
where p.role = 'ADMIN'
   or exists (
     select 1 from public.profile_roles pr
     where pr.profile_id = p.id and pr.role = 'ADMIN'
   )
on conflict do nothing;

update public.profiles
set v2_permissions_backfilled_at = coalesce(v2_permissions_backfilled_at, now()),
    v2_permissions_backfill_source = coalesce(v2_permissions_backfill_source, 'fase-1-legacy-roles')
where v2_permissions_backfilled_at is null;

alter table public.profile_appointments enable row level security;
alter table public.profile_capabilities enable row level security;
alter table public.profile_responsibilities enable row level security;
alter table public.group_responsibility_assignments enable row level security;
alter table public.permission_audit_snapshots enable row level security;

revoke all on table public.profile_appointments, public.profile_capabilities,
  public.profile_responsibilities, public.group_responsibility_assignments,
  public.permission_audit_snapshots from anon, authenticated;
revoke all on function public.assert_v2_responsibility_eligibility(uuid, public.profile_responsibility_kind) from public, anon, authenticated;
revoke all on function public.assert_v2_exactly_one_appointment(uuid) from public, anon, authenticated;
revoke all on function public.enforce_v2_profile_appointment_count() from public, anon, authenticated;
revoke all on function public.enforce_v2_new_profile_appointment_count() from public, anon, authenticated;
revoke all on function public.ensure_v2_profile_appointment() from public, anon, authenticated;
revoke all on function public.validate_v2_global_responsibility() from public, anon, authenticated;
revoke all on function public.validate_v2_group_responsibility() from public, anon, authenticated;
revoke all on function public.prevent_v2_permission_dependency_break() from public, anon, authenticated;
grant execute on function public.assert_v2_responsibility_eligibility(uuid, public.profile_responsibility_kind) to service_role;
grant execute on function public.assert_v2_exactly_one_appointment(uuid) to service_role;
grant execute on function public.enforce_v2_profile_appointment_count() to service_role;
grant execute on function public.enforce_v2_new_profile_appointment_count() to service_role;
grant execute on function public.ensure_v2_profile_appointment() to service_role;
grant execute on function public.validate_v2_global_responsibility() to service_role;
grant execute on function public.validate_v2_group_responsibility() to service_role;
grant execute on function public.prevent_v2_permission_dependency_break() to service_role;

commit;
