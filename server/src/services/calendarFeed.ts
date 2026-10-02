import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { PLATFORM_LABEL, type Platform } from '../domain/types.js';
import { buildCalendar, type IcsEvent } from '../domain/ics.js';
import { BRAND } from '../domain/brand.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Issues a new link, replacing any earlier one. The token is returned once and is never recoverable afterwards. */
export async function createFeedToken(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `insert into calendar_feeds(user_id, token_hash) values ($1,$2)
     on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now()`,
    [userId, sha256(token)],
  );
  return token;
}

export async function revokeFeed(db: Db, userId: string): Promise<void> {
  await db.query('delete from calendar_feeds where user_id=$1', [userId]);
}

export async function feedStatus(db: Db, userId: string): Promise<{ enabled: boolean; createdAt: string | null }> {
  const r = (await db.query('select created_at from calendar_feeds where user_id=$1', [userId])).rows[0];
  return { enabled: !!r, createdAt: r ? r.created_at.toISOString() : null };
}

export async function userForToken(db: Db, token: string): Promise<string | null> {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const r = (await db.query('select user_id from calendar_feeds where token_hash=$1', [sha256(token)])).rows[0];
  return r ? (r.user_id as string) : null;
}

interface Row {
  id: string; platform: Platform; title: string; start_at: Date; end_at: Date; contest_url: string | null; registration_url: string | null;
  rated: boolean; committed: boolean;
}

function toEvent(r: Row, relevant: boolean): IcsEvent {
  const name = `${PLATFORM_LABEL[r.platform]} ${r.title}`;
  const parts = [
    r.rated ? 'Rated contest.' : 'Unrated contest.',
    r.committed ? 'You have committed to this contest.' : 'You have not yet committed to this contest.',
    r.committed ? 'Preparation begins one hour beforehand.' : 'Committing in the application schedules preparation.',
  ];
  return {
    uid: `contest-${r.id}@${BRAND.toLowerCase()}`,
    start: r.start_at.getTime(),
    end: r.end_at.getTime(),
    summary: r.committed ? `${name} (committed)` : name,
    description: parts.join(' '),
    url: r.contest_url ?? r.registration_url,
    // The 24-hour alert matches the push schedule for every relevant rated contest; the nearer alerts are for commitments.
    alarmsMinutes: r.committed ? [24 * 60, 60, 10] : relevant ? [24 * 60] : [],
    tentative: !r.committed,
  };
}

/**
 * Upcoming and in-progress contests that matter to this person: those committed to, and rated contests on a
 * platform the person has connected. This mirrors the reminder schedule, so the calendar and the push
 * notifications never disagree about which contests are in scope.
 */
export async function feedEvents(db: Db, userId: string, now: number): Promise<IcsEvent[]> {
  const mine = new Set((await db.query(
    `select platform from platform_stats where user_id=$1 union select platform from platform_accounts where user_id=$1 and username <> ''`, [userId],
  )).rows.map((r) => r.platform as string));
  const rows = (await db.query(
    `select c.id, c.platform, c.title, c.start_at, c.end_at, c.contest_url, c.registration_url, c.rated, (cm.id is not null) as committed
       from contests c left join contest_commitments cm on cm.contest_id = c.id and cm.user_id = $1
      where c.cancelled_at is null and c.end_at > $2 and c.start_at < $3 order by c.start_at`,
    [userId, new Date(now), new Date(now + 60 * 86_400_000)],
  )).rows as Row[];
  return rows
    .filter((r) => r.committed || (r.rated && mine.has(r.platform)))
    .map((r) => toEvent(r, r.rated && mine.has(r.platform)));
}

export async function feedCalendar(db: Db, userId: string, now: number): Promise<string> {
  return buildCalendar(await feedEvents(db, userId, now), now);
}

/** One contest as a file the person can open in any calendar application. */
export async function contestCalendar(db: Db, userId: string, contestId: string, now: number): Promise<string | null> {
  const r = (await db.query(
    `select c.id, c.platform, c.title, c.start_at, c.end_at, c.contest_url, c.registration_url, c.rated, (cm.id is not null) as committed
       from contests c left join contest_commitments cm on cm.contest_id = c.id and cm.user_id = $1
      where c.id = $2 and c.cancelled_at is null`, [userId, contestId],
  )).rows[0] as Row | undefined;
  if (!r) return null;
  const e = toEvent(r, r.rated);
  // A file the person chose to download should alert at every stage, committed or not.
  e.alarmsMinutes = [24 * 60, 60, 10];
  return buildCalendar([e], now);
}
