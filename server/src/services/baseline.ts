import type { Db } from '../db/pool.js';
import type { Platform } from '../domain/types.js';

/**
 * Re-baseline a platform's counts. The given totals are authoritative as of `at`; anything the
 * pipeline records after `at` is counted on top, exactly once. A count that is not supplied is
 * carried forward together with everything recorded since the previous baseline.
 */
export async function rebaseline(
  db: Db, userId: string, platform: Platform, totals: { problems?: number | null; contests?: number | null }, at: Date,
) {
  await db.query(
    `update platform_stats set
        base_problems = coalesce($3, base_problems + (select count(*)::int from solved_problems sp
                                   where sp.user_id=$1 and sp.platform=$2 and sp.first_accepted_at > platform_stats.base_as_of)),
        base_contests = coalesce($4, base_contests + (select count(*)::int from contest_participations cp
                                   join contests c on c.id = cp.contest_id
                                  where cp.user_id=$1 and cp.platform=$2 and cp.participated and c.end_at > platform_stats.base_as_of)),
        base_as_of = $5
      where user_id=$1 and platform=$2`,
    [userId, platform, totals.problems ?? null, totals.contests ?? null, at],
  );
}
