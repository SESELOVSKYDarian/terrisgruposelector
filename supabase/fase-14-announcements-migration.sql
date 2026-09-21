-- Fase 14: anuncios generales (avisos por lluvia, cambios, etc.). Los publican el Coordinador y
-- el Superintendente de Servicio; generan notificacion interna + push a cada usuario activo y
-- quedan visibles en la app. Se archivan, no se borran. Aditiva e idempotente.

begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  constraint announcements_title_not_blank check (length(btrim(title)) > 0),
  constraint announcements_description_not_blank check (length(btrim(description)) > 0)
);

create index if not exists announcements_visible_idx on public.announcements (created_at desc) where archived_at is null;

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;

commit;
