-- Fase 20: integracion S-13 con Google Docs (preparada, NO activa). La base de datos sigue siendo la
-- fuente de verdad; el Doc es una representacion. Cada documento tiene un modo de sincronizacion:
--   DRY_RUN     (por defecto) calcula y registra que cambiaria, sin escribir en ningun lado;
--   STAGING     escribe solo en una COPIA de prueba (staging_document_id);
--   PRODUCTION  escribe en el documento real, solo tras verificar el staging.
-- Aditiva e idempotente.

begin;

alter table public.s13_documents
  add column if not exists staging_document_id text,
  add column if not exists sync_mode text not null default 'DRY_RUN',
  add column if not exists staging_verified_at timestamptz,
  add column if not exists last_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's13_documents_sync_mode_check') then
    alter table public.s13_documents
      add constraint s13_documents_sync_mode_check check (sync_mode in ('DRY_RUN', 'STAGING', 'PRODUCTION'));
  end if;
end $$;

-- Ultimo estado escrito con exito en el Doc (para enviar solo diferencias). Una fila por celda logica.
create table if not exists public.s13_sync_snapshots (
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  cell_key text not null,
  value text not null,
  synced_at timestamptz not null default now(),
  primary key (document_id, cell_key)
);

-- Cada intento de sincronizacion (incluidas las simulaciones).
create table if not exists public.s13_sync_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  mode text not null,
  status text not null default 'RUNNING',
  triggered_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text,
  constraint s13_sync_runs_status_check check (status in ('RUNNING', 'SIMULATED', 'SENT', 'FAILED', 'BLOCKED'))
);

-- Cambios pendientes/enviados de cada corrida (outbox): una fila por celda que cambia.
create table if not exists public.s13_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.s13_sync_runs(id) on delete cascade,
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  cell_key text not null,
  operation text not null,
  value text,
  status text not null default 'PENDING',
  last_error text,
  created_at timestamptz not null default now(),
  constraint s13_sync_outbox_operation_check check (operation in ('SET', 'CLEAR')),
  constraint s13_sync_outbox_status_check check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

create index if not exists s13_sync_runs_document_idx on public.s13_sync_runs (document_id, started_at desc);
create index if not exists s13_sync_outbox_run_idx on public.s13_sync_outbox (run_id);

alter table public.s13_sync_snapshots enable row level security;
alter table public.s13_sync_runs enable row level security;
alter table public.s13_sync_outbox enable row level security;
revoke all on table public.s13_sync_snapshots, public.s13_sync_runs, public.s13_sync_outbox from anon, authenticated;

commit;
