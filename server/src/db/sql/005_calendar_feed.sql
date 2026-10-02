-- A private calendar link per person. The address carries a random 256-bit token; only its SHA-256 hash is stored,
-- so a copy of this table cannot be used to read anyone's calendar. Creating a new link replaces the old one, and
-- revoking deletes the row. Row Level Security is enabled on every table at start, with no public policy.
create table if not exists calendar_feeds (
  user_id uuid primary key references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
