-- S-13 test area: entries created from the test form are flagged so only they can be deleted from it.
alter table public.territory_rounds add column if not exists is_test boolean not null default false;
