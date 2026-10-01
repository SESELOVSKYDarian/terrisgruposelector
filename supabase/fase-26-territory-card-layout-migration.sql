-- Fase 26: per-territory visual card layout (block shapes + street labels), like the real
-- paper S-13 territory card. One row per territory; blocks are keyed by label (same string
-- used everywhere else: territory_rounds.pending_block_labels, S-13, etc.), not by block id.

create table if not exists territory_card_layouts (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null unique references territories(id) on delete cascade,
  view_box text not null default '0 0 400 400',
  blocks jsonb not null default '[]'::jsonb,
  street_labels jsonb not null default '[]'::jsonb,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
