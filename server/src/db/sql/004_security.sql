-- Server-side sessions. The browser holds an opaque random token; only its SHA-256 hash is stored here,
-- so a copy of this table cannot be replayed as a session. Signing out deletes the row.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

-- A contest that disappears from its source's successful listing before it starts is treated as cancelled:
-- it leaves the fixtures and its pending reminders are withdrawn. It returns if the source lists it again.
alter table contests add column if not exists cancelled_at timestamptz;
