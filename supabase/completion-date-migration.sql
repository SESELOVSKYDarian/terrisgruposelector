alter table public.block_round_statuses
  add column if not exists completed_on date;
