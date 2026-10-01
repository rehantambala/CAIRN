-- CAIRN for any number of people. Existing rows are kept: the current owner becomes the first account.
--
-- Table classification
--   GLOBAL      problems, contests, source_health, kv, schema_migrations
--   USER-OWNED  users, auth_identities, platform_accounts, platform_stats, submissions, solved_problems,
--               contest_participations, contest_commitments, rating_history, score_snapshots,
--               daily_objectives (+ items via objective), activity_events, notifications,
--               push_subscriptions, awards, strategist_notes

-- A person may sign in with a provider that discloses no email, and need never set a password.
alter table users alter column email drop not null;
alter table users alter column password_hash drop not null;
alter table users add column if not exists avatar_url text;
alter table users add column if not exists last_seen_at timestamptz;
-- Contest reminder preferences (all on by default).
alter table users add column if not exists remind_enabled boolean not null default true;
alter table users add column if not exists remind_24h boolean not null default true;
alter table users add column if not exists remind_1h boolean not null default true;
alter table users add column if not exists remind_10m boolean not null default true;

-- Who a person is to Google or GitHub. The CAIRN identity is users.id; these only point at it.
create table if not exists auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,                -- google | github
  provider_user_id text not null,        -- Google "sub", GitHub numeric id: stable, never the email or login
  provider_email text,
  provider_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

-- Profile connection lifecycle, kept apart from statistics.
alter table platform_accounts add column if not exists verified_at timestamptz;
alter table platform_accounts add column if not exists last_error text;
alter table platform_accounts add column if not exists disconnected_at timestamptz;

-- Where each contest came from and when that source last confirmed it.
alter table contests add column if not exists source text;
alter table contests add column if not exists first_seen_at timestamptz not null default now();
alter table contests add column if not exists last_verified_at timestamptz;

-- Health of each global source (contest listings), so a failure is shown instead of silently emptying a list.
create table if not exists source_health (
  key text primary key,                  -- e.g. contests:codechef
  status text not null,                  -- SYNCED | STALE | ERROR | UNAVAILABLE
  last_ok_at timestamptz,
  checked_at timestamptz not null default now(),
  message text
);

-- The strategist's interpretation for a user and day. Advisory text only; never read by the score engine.
create table if not exists strategist_notes (
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  context_hash text not null,
  body_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);
