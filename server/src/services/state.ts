import type { Db } from '../db/pool.js';
import { computeScore, type ScoreInputs } from '../domain/score.js';
import { ALL_PLATFORMS, RATED_PLATFORMS, type Platform, type RatedPlatform, type SourceState } from '../domain/types.js';

export interface StatRow {
  platform: Platform;
  problems: number;
  contests: number;
  rating: number | null;
  contribution: number | null;
  sourceStatus: SourceState;
  sourceNote: string | null;
  lastUpdatedAt: Date | null;
  baseAsOf: Date;
  username: string | null;
  lastSyncedAt: Date | null;
  /** the user has this platform: figures entered or a profile connected */
  known: boolean;
  connectionStatus: string;
  verifiedAt: Date | null;
  lastError: string | null;
}

export type Connection = 'NOT_CONNECTED' | 'PENDING_VERIFICATION' | 'LIVE' | 'SYNCED' | 'STALE' | 'ERROR' | 'MANUAL' | 'UNAVAILABLE';

/**
 * One honest word for a profile. LIVE only when the source verified it within ten minutes; MANUAL when figures
 * are entered by the person; UNAVAILABLE when a handle is held but the source cannot be read on this server.
 */
export function connectionOf(s: StatRow, capability: 'AUTOMATIC' | 'IMPORT' | 'MANUAL'): Connection {
  if (s.connectionStatus === 'PENDING') return 'PENDING_VERIFICATION';
  if (!s.username) return s.known && s.sourceStatus !== 'ERROR' ? 'MANUAL' : 'NOT_CONNECTED';
  if (capability !== 'AUTOMATIC') return capability === 'IMPORT' && !s.known ? 'UNAVAILABLE' : 'MANUAL';
  if (s.connectionStatus === 'ERROR' || s.sourceStatus === 'ERROR') return 'ERROR';
  if (s.sourceStatus === 'LIVE') return 'LIVE';
  if (s.sourceStatus === 'STALE') return 'STALE';
  return s.lastSyncedAt ? 'SYNCED' : 'PENDING_VERIFICATION';
}

const STALE_AFTER_MS: Record<Platform, number> = {
  codeforces: 6 * 3_600_000,
  leetcode: 12 * 3_600_000,
  codechef: 12 * 3_600_000,
  smartinterviews: 14 * 86_400_000,
  interviewbit: 14 * 86_400_000,
  hackerrank: 14 * 86_400_000,
};

/** Freshness is computed, never stored as a promise: anything older than its window is STALE. */
export function effectiveStatus(platform: Platform, status: SourceState, lastUpdated: Date | null, now: number): SourceState {
  if (status === 'ERROR') return 'ERROR';
  if (!lastUpdated) return status;
  if (status === 'LIVE' && now - lastUpdated.getTime() > 10 * 60_000) return 'SYNCED';
  if (now - lastUpdated.getTime() > STALE_AFTER_MS[platform]) return 'STALE';
  return status;
}

export async function loadStats(db: Db, userId: string, now = Date.now()): Promise<StatRow[]> {
  const { rows } = await db.query(
    `select s.platform, s.rating, s.contribution, s.source_status, s.source_note, s.last_updated_at, s.base_as_of,
            s.base_problems + (select count(*)::int from solved_problems sp
                                where sp.user_id = s.user_id and sp.platform = s.platform
                                  and sp.first_accepted_at > s.base_as_of) as problems,
            s.base_contests + (select count(*)::int from contest_participations cp
                                 join contests c on c.id = cp.contest_id
                                where cp.user_id = s.user_id and cp.platform = s.platform
                                  and cp.participated and c.end_at > s.base_as_of) as contests,
            1 as has_stats
       from platform_stats s
      where s.user_id = $1`,
    [userId],
  );
  const accounts = new Map<string, any>((await db.query(
    'select platform, username, last_synced_at, connection_status, verified_at, last_error from platform_accounts where user_id=$1', [userId],
  )).rows.map((r) => [r.platform, r]));
  const byPlatform = new Map<string, any>(rows.map((r) => [r.platform, r]));
  return ALL_PLATFORMS.map((p) => {
    const r = byPlatform.get(p);
    const last: Date | null = r?.last_updated_at ?? null;
    return {
      platform: p,
      problems: r?.problems ?? 0,
      contests: r?.contests ?? 0,
      rating: r?.rating ?? null,
      contribution: r?.contribution ?? null,
      sourceStatus: effectiveStatus(p, (r?.source_status ?? 'MANUAL') as SourceState, last, now),
      sourceNote: r?.source_note ?? null,
      lastUpdatedAt: last,
      baseAsOf: r?.base_as_of ?? new Date(0),
      username: accounts.get(p)?.username || null,
      lastSyncedAt: accounts.get(p)?.last_synced_at ?? null,
      known: !!r,
      connectionStatus: (accounts.get(p)?.connection_status ?? 'DISCONNECTED') as string,
      verifiedAt: accounts.get(p)?.verified_at ?? null,
      lastError: accounts.get(p)?.last_error ?? null,
    };
  });
}

export function toScoreInputs(stats: StatRow[]): ScoreInputs {
  const g = (p: Platform) => stats.find((s) => s.platform === p)!;
  const rated = (p: RatedPlatform) => ({ problems: g(p).problems, rating: g(p).rating ?? 0, contests: g(p).contests });
  return {
    leetcode: rated('leetcode'), codechef: rated('codechef'), codeforces: rated('codeforces'),
    hackerrank: g('hackerrank').contribution ?? 0,
    smartinterviews: g('smartinterviews').contribution ?? 0,
    interviewbit: g('interviewbit').contribution ?? 0,
  };
}

export async function loadScore(db: Db, userId: string) {
  const stats = await loadStats(db, userId);
  const inputs = toScoreInputs(stats);
  return { stats, inputs, score: computeScore(inputs) };
}

export async function getUser(db: Db, userId: string) {
  const { rows } = await db.query('select * from users where id = $1', [userId]);
  const u = rows[0];
  if (!u) throw new Error('user not found');
  return {
    id: u.id as string, email: u.email as string, displayName: u.display_name as string,
    timezone: u.timezone as string, targetScore: u.target_score as number,
    targetDate: (u.target_date as string | null) ?? null, dailyMinutes: u.daily_minutes as number,
  };
}

export async function recordEvent(
  db: Db, userId: string, type: string, platform: Platform | null, sourceId: string | null, payload: object = {},
) {
  await db.query(
    'insert into activity_events(user_id, event_type, platform, source_id, payload_json) values ($1,$2,$3,$4,$5)',
    [userId, type, platform, sourceId, JSON.stringify(payload)],
  );
}

export { RATED_PLATFORMS };

export const knownRated = (stats: StatRow[]): RatedPlatform[] =>
  RATED_PLATFORMS.filter((p) => stats.find((s) => s.platform === p)?.known);
