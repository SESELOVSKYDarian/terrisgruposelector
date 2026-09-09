alter type public.app_role add value if not exists 'PUBLICADOR';

alter table profiles add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending','approved'));
