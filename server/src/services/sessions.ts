import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/pool.js';

/**
 * Sessions are opaque: 256 random bits, base64url-encoded, carried in an HttpOnly cookie. The token holds no
 * personal information and cannot be forged or decoded. Only its SHA-256 hash is stored, so the sessions table
 * cannot be replayed. Every sign-in creates a new token (no session fixation); sign-out deletes it.
 */
export const SESSION_TTL_MS = 30 * 86_400_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string, now = Date.now()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + SESSION_TTL_MS);
  await db.query('insert into sessions(token_hash, user_id, created_at, expires_at, last_seen_at) values ($1,$2,$3,$4,$3)',
    [hash(token), userId, new Date(now), expiresAt]);
  // Housekeeping: expired rows are useless and are removed opportunistically.
  await db.query('delete from sessions where expires_at < $1', [new Date(now)]);
  return { token, expiresAt };
}

/** The user a token belongs to, or null if it is malformed, unknown or expired. */
export async function resolveSession(db: Db, token: string | null, now = Date.now()): Promise<string | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const r = await db.query(
    `update sessions set last_seen_at = case when last_seen_at < $2::timestamptz - interval '5 minutes' then $2::timestamptz else last_seen_at end
      where token_hash = $1 and expires_at > $2 returning user_id`, [hash(token), new Date(now)]);
  return (r.rows[0]?.user_id as string | undefined) ?? null;
}

export async function revokeSession(db: Db, token: string | null): Promise<void> {
  if (!token || !TOKEN_RE.test(token)) return;
  await db.query('delete from sessions where token_hash = $1', [hash(token)]);
}

/** Signs a person out on every device. */
export async function revokeAllSessions(db: Db, userId: string): Promise<number> {
  return (await db.query('delete from sessions where user_id = $1', [userId])).rowCount ?? 0;
}
