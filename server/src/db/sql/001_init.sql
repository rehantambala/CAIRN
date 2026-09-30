create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  timezone text not null default 'Asia/Kolkata',
  target_score int not null default 25000,
  target_date date,
  daily_minutes int not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  username text not null,
  external_user_id text,
  connection_status text not null default 'DISCONNECTED',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

-- Counts are derived: base value (import/seed) + events after base_as_of.
create table platform_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  base_problems int not null default 0,
  base_contests int not null default 0,
  base_as_of timestamptz not null default now(),
  rating int,
  contribution int,               -- SI / IB / HR manual or imported contribution
  source_status text not null default 'MANUAL',
  source_note text,
  last_updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create table problems (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_problem_id text not null,
  title text not null,
  url text not null,
  difficulty text,
  topic text,
  metadata_json jsonb,
  unique (platform, external_problem_id)
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  external_submission_id text,
  external_problem_id text not null,
  verdict text not null,
  submitted_at timestamptz not null,
  accepted_at timestamptz,
  contest_id text
);
create unique index submissions_ext_uq on submissions (user_id, platform, external_submission_id)
  where external_submission_id is not null;

create table solved_problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  external_problem_id text not null,
  first_accepted_at timestamptz not null,
  source_submission_id uuid references submissions(id) on delete set null,
  source text not null default 'SYNC',   -- SYNC | IMPORT | MANUAL
  unique (user_id, platform, external_problem_id)
);

create table contests (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_contest_id text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  registration_url text,
  contest_url text,
  rated boolean not null default true,
  metadata_json jsonb,
  unique (platform, external_contest_id)
);
create index contests_start_idx on contests (start_at);

create table contest_participations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  contest_id uuid not null references contests(id) on delete cascade,
  participated boolean not null default true,
  rating_before int,
  rating_after int,
  rating_delta int,
  result_metadata_json jsonb,
  source text not null default 'SYNC',
  synced_at timestamptz not null default now(),
  unique (user_id, contest_id)
);

create table contest_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  contest_id uuid not null references contests(id) on delete cascade,
  prep_minutes int not null default 30,
  committed_at timestamptz not null default now(),
  unique (user_id, contest_id)
);

create table rating_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  rating int not null,
  contest_external_id text,
  recorded_at timestamptz not null,
  unique (user_id, platform, recorded_at)
);

create table score_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  overall_score int not null,
  leetcode_score int not null,
  codechef_score int not null,
  codeforces_score int not null,
  smart_interviews_score int not null,
  interviewbit_score int not null,
  hackerrank_score int not null,
  captured_at timestamptz not null default now()
);
create index snapshots_user_time on score_snapshots (user_id, captured_at);

create table daily_objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  target_score_delta int not null default 0,
  status text not null default 'ACTIVE',     -- ACTIVE | COMPLETE | PARTIAL | MISSED | REST
  trajectory_status text not null,
  is_rest boolean not null default false,
  rationale_json jsonb not null default '[]',
  score_at_start int,
  score_at_close int,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, date)
);

create table daily_objective_items (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references daily_objectives(id) on delete cascade,
  position int not null,
  type text not null,
  platform text,
  external_problem_id text,
  contest_id uuid references contests(id) on delete set null,
  title text not null,
  reason text not null,
  required boolean not null default true,
  quota int not null default 1,
  completed_count int not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  verification text not null default 'PENDING',
  suggestions_json jsonb not null default '[]',
  minutes int not null default 0,
  points int not null default 0
);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  platform text,
  source_id text,
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_user_time on activity_events (user_id, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  scheduled_for timestamptz not null,
  delivered_at timestamptz,
  status text not null default 'PENDING',    -- PENDING | DELIVERED | SKIPPED | FAILED
  payload_json jsonb not null default '{}',
  unique (user_id, type, dedupe_key)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  award_type text not null,
  achieved_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}',
  unique (user_id, award_type)
);
