alter table users add column if not exists github_login text;

-- Small key-value store for housekeeping facts such as "when was the pool last refreshed".
create table if not exists kv (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
