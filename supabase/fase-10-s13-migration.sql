-- Fase 10: documentos S-13. La base de datos es la fuente de verdad: el S-13 se calcula
-- siempre desde territory_rounds/territory_visits; esta tabla solo define que documento
-- cubre que rango de territorios (y, mas adelante, el id del Google Doc real).
-- Aditiva e idempotente.

begin;

create table if not exists public.s13_documents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  first_territory integer not null check (first_territory > 0),
  last_territory integer not null,
  -- Se completa en la Fase 20 cuando se entreguen los Google Docs reales.
  external_document_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint s13_documents_range check (last_territory >= first_territory)
);

insert into public.s13_documents (code, title, first_territory, last_territory)
values
  ('S13_1_20', 'S-13 1-20 (Automatizado)', 1, 20),
  ('S13_21_36', 'S-13 21-36 (Automatizado)', 21, 36)
on conflict (code) do nothing;

alter table public.s13_documents enable row level security;
revoke all on table public.s13_documents from anon, authenticated;

commit;
