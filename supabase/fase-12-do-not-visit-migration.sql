-- Fase 12: direcciones "No visitar". Solo lo necesario: territorio, direccion, fecha agregada
-- y activo/inactivo. Quien lo cambia y cuando queda en audit_log. Aditiva e idempotente.

begin;

create table if not exists public.do_not_visit_addresses (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  address text not null,
  active boolean not null default true,
  -- Fecha agregada.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint do_not_visit_address_not_blank check (length(btrim(address)) > 0)
);

create index if not exists do_not_visit_territory_active_idx on public.do_not_visit_addresses (territory_id) where active;

alter table public.do_not_visit_addresses enable row level security;
revoke all on table public.do_not_visit_addresses from anon, authenticated;

commit;
