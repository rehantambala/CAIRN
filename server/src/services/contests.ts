import type { Db } from '../db/pool.js';
import type { ContestState, Platform } from '../domain/types.js';
import { recordEvent } from './state.js';

export interface ContestInput {
  platform: Platform;
  externalContestId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  registrationUrl?: string | null;
  contestUrl?: string | null;
  rated?: boolean;
  /** which source confirmed this contest (codeforces-api, leetcode, codechef, clist, file) */
  source?: string;
}

/** Upsert by (platform, external id). Returns the row id and whether it was new. */
export async function upsertContest(db: Db, userId: string | null, c: ContestInput): Promise<{ id: string; isNew: boolean }> {
  const r = await db.query(
    `insert into contests(platform, external_contest_id, title, start_at, end_at, registration_url, contest_url, rated, source, last_verified_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $9::text is not null then now() end)
     on conflict (platform, external_contest_id) do update set
       title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at,
       registration_url = coalesce(excluded.registration_url, contests.registration_url),
       contest_url = coalesce(excluded.contest_url, contests.contest_url), rated = excluded.rated,
       source = coalesce(excluded.source, contests.source), last_verified_at = coalesce(excluded.last_verified_at, contests.last_verified_at)
     returning id, (xmax = 0) as inserted`,
    [c.platform, c.externalContestId, c.title, c.startAt, c.endAt, c.registrationUrl ?? null, c.contestUrl ?? null, c.rated ?? true, c.source ?? null],
  );
  const { id, inserted } = r.rows[0];
  if (inserted && userId) await recordEvent(db, userId, 'CONTEST_DISCOVERED', c.platform, id, { title: c.title, startAt: c.startAt });
  return { id, isNew: inserted };
}

export async function recordParticipation(
  db: Db, userId: string, platform: Platform, contestId: string,
  p: { ratingBefore?: number | null; ratingAfter?: number | null; source: 'SYNC' | 'MANUAL' | 'IMPORT' },
): Promise<{ isNew: boolean }> {
  const delta = p.ratingBefore != null && p.ratingAfter != null ? p.ratingAfter - p.ratingBefore : null;
  const r = await db.query(
    `insert into contest_participations(user_id, platform, contest_id, participated, rating_before, rating_after, rating_delta, source)
     values ($1,$2,$3,true,$4,$5,$6,$7)
     on conflict (user_id, contest_id) do update set
       rating_before = coalesce(excluded.rating_before, contest_participations.rating_before),
       rating_after  = coalesce(excluded.rating_after,  contest_participations.rating_after),
       rating_delta  = coalesce(excluded.rating_delta,  contest_participations.rating_delta),
       source = case when excluded.source <> 'MANUAL' then excluded.source else contest_participations.source end,
       synced_at = now()
     returning (xmax = 0) as inserted`,
    [userId, platform, contestId, p.ratingBefore ?? null, p.ratingAfter ?? null, delta, p.source],
  );
  const isNew = r.rows[0].inserted as boolean;
  if (isNew) await recordEvent(db, userId, 'CONTEST_PARTICIPATED', platform, contestId, { source: p.source });
  return { isNew };
}

export async function recordRating(
  db: Db, userId: string, platform: Platform, rating: number, at: Date, contestExternalId: string | null,
): Promise<{ changed: boolean }> {
  const ins = await db.query(
    `insert into rating_history(user_id, platform, rating, contest_external_id, recorded_at)
     values ($1,$2,$3,$4,$5) on conflict (user_id, platform, recorded_at) do nothing returning id`,
    [userId, platform, rating, contestExternalId, at],
  );
  const latest = (await db.query(
    'select rating from rating_history where user_id=$1 and platform=$2 order by recorded_at desc limit 1', [userId, platform],
  )).rows[0];
  if (!latest) return { changed: false };
  const cur = (await db.query('select rating from platform_stats where user_id=$1 and platform=$2', [userId, platform])).rows[0];
  if (cur?.rating === latest.rating) return { changed: false };
  await db.query(
    `insert into platform_stats(user_id, platform, rating, last_updated_at) values ($1,$2,$3,now())
     on conflict (user_id, platform) do update set rating = excluded.rating, last_updated_at = now()`,
    [userId, platform, latest.rating],
  );
  if (ins.rows[0]) await recordEvent(db, userId, 'RATING_CHANGED', platform, contestExternalId, { rating: latest.rating, from: cur?.rating ?? null });
  return { changed: true };
}

export function contestState(
  c: { startAt: number; endAt: number }, now: number, committed: boolean, attended: boolean,
): ContestState {
  if (now < c.startAt) return c.startAt - now <= 2 * 3_600_000 ? 'STARTING_SOON' : 'UPCOMING';
  if (now < c.endAt) return 'LIVE';
  if (attended) return 'ATTENDED';
  return committed ? 'MISSED' : 'FINISHED';
}
