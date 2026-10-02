import type { Db } from '../db/pool.js';
import type { Platform } from '../domain/types.js';
import { rebaseline } from './baseline.js';
import { recordRating } from './contests.js';
import { ingestAccepted } from './pipeline.js';

export interface Figures {
  platform: Platform;
  problemsSolved?: number;
  contests?: number;
  rating?: number;
  contribution?: number;
  solved?: { id: string; acceptedAt?: string }[];
  note?: string;
}

/**
 * Sets a platform's figures from numbers the person supplies (an entry form, or a leaderboard export). The supplied
 * counts become the baseline as of now, so problems accepted afterwards are counted on top, once. The caller owns
 * the transaction, and records the event and refreshes the derived state once its own work is complete.
 */
export async function applyFigures(c: Db, userId: string, b: Figures, now = new Date()): Promise<'MANUAL' | 'IMPORTED'> {
  const status = b.contribution !== undefined && !['leetcode', 'codechef', 'codeforces'].includes(b.platform) ? 'MANUAL' : 'IMPORTED';
  await c.query(
    `insert into platform_stats(user_id, platform, base_as_of, source_status, source_note, last_updated_at)
     values ($1,$2,$3,$4,$5,$3) on conflict (user_id, platform) do nothing`, [userId, b.platform, now, status, b.note ?? null],
  );
  if (b.problemsSolved !== undefined || b.contests !== undefined) {
    await rebaseline(c, userId, b.platform, { problems: b.problemsSolved, contests: b.contests }, now);
  }
  if (b.contribution !== undefined) await c.query('update platform_stats set contribution=$3 where user_id=$1 and platform=$2', [userId, b.platform, b.contribution]);
  await c.query('update platform_stats set source_status=$3, source_note=$4, last_updated_at=$5 where user_id=$1 and platform=$2', [userId, b.platform, status, b.note ?? null, now]);
  if (b.rating !== undefined) await recordRating(c, userId, b.platform, b.rating, now, null);
  for (const s of b.solved ?? []) {
    // Historic ids are remembered (never re-suggested, never double counted) unless a real timestamp is given.
    await ingestAccepted(c, userId, {
      platform: b.platform, externalProblemId: s.id, acceptedAt: s.acceptedAt ? new Date(s.acceptedAt) : new Date(0), source: 'IMPORT',
    });
  }
  return status;
}
