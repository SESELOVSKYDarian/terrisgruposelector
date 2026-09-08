-- Agrega el rol CONDUCTOR y pasa de "un rol por usuario" a "una lista de roles por usuario".
-- profiles.role se deja como esta (compatibilidad), pero la app deja de leerlo.

alter type public.app_role add value if not exists 'CONDUCTOR';

create table public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, role)
);

-- migrar los roles actuales (todo usuario existente conserva su rol de hoy)
insert into public.profile_roles (profile_id, role)
select id, role from public.profiles
on conflict do nothing;

alter table public.profile_roles enable row level security;
create policy "profile_roles admin manage" on public.profile_roles for all using (false) with check (false);
