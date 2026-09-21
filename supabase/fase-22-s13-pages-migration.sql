-- Fase 22: hojas del S-13. Cada "hoja" (4 rondas por territorio) es un Google Doc propio: la hoja 1 es el
-- documento original (s13_documents.external_document_id / staging_document_id); cuando a algun territorio
-- se le acaban las 4 rondas, el sistema COPIA la hoja anterior, la deja en blanco y sigue completando la
-- nueva. Esta tabla guarda el Doc de cada hoja >= 2, separado por destino (copia de prueba / real).
-- Tambien carga los IDs de los dos documentos reales. Sigue en modo DRY_RUN: no escribe nada por si sola.
-- Aditiva e idempotente. Requiere fase-10 y fase-20.

begin;

create table if not exists public.s13_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.s13_documents(id) on delete cascade,
  page integer not null check (page >= 2),
  target text not null,
  google_document_id text not null,
  -- Se completa cuando la copia ya quedo en blanco (si falla a mitad, se reintenta).
  prepared_at timestamptz,
  created_at timestamptz not null default now(),
  constraint s13_document_pages_target_check check (target in ('STAGING', 'PRODUCTION')),
  unique (document_id, page, target)
);

alter table public.s13_document_pages enable row level security;
revoke all on table public.s13_document_pages from anon, authenticated;

-- Documentos reales entregados (solo si todavia no hay ninguno cargado).
update public.s13_documents set external_document_id = '1oP_nbrEeGYJddAZrzcIOe6t2A9jJAwVmj1oIfLNXk58', updated_at = now()
where code = 'S13_1_20' and external_document_id is null;
update public.s13_documents set external_document_id = '1Yr5dKQc1ADRYQDkUqcpug1zpDc1ryb7sJF5yC65t8S8', updated_at = now()
where code = 'S13_21_36' and external_document_id is null;

commit;
