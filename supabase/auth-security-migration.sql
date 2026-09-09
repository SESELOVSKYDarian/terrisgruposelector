alter table profiles add column if not exists email text unique;

create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_label text,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_credentials_profile_id_idx on webauthn_credentials(profile_id);
