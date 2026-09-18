-- Fase 5: dispositivos push y registro aditivo de ejecuciones del scheduler.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null, device_name text not null, endpoint text not null, p256dh text not null, auth text not null,
  enabled boolean not null default true, disabled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint push_subscriptions_device_name_not_blank check (length(trim(device_name)) > 0),
  constraint push_subscriptions_user_device_unique unique (profile_id, device_id), constraint push_subscriptions_endpoint_unique unique (endpoint)
);
create index if not exists push_subscriptions_profile_enabled_idx on public.push_subscriptions (profile_id) where enabled;
create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), job_type text not null, natural_key text not null, run_after timestamptz not null,
  status text not null default 'PENDING', payload jsonb not null default '{}'::jsonb, last_error text, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint scheduled_jobs_status_valid check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')), constraint scheduled_jobs_natural_key_unique unique (natural_key)
);
create index if not exists scheduled_jobs_due_idx on public.scheduled_jobs (run_after) where status = 'PENDING';
alter table public.push_subscriptions enable row level security;
alter table public.scheduled_jobs enable row level security;
create policy "users manage own push subscriptions" on public.push_subscriptions for all to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);
