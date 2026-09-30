/**
 * DEVELOPMENT ONLY. Writes synthetic history so calendar, trajectory and analytics can be
 * inspected. Every row it creates is tagged {"demo":true} in activity_events. Never run in production,
 * never run against the owner's real database.
 */
import { config } from '../config.js';
import { migrate } from './migrate.js';
import { pool, tx } from './pool.js';
import { loadProblemPool, seedDevContests, seedOwner } from './seed.js';
import { addDays, dayKey, dayStart } from '../domain/time.js';

if (config.isProd) throw new Error('refusing to write demo data in production');

const DAYS = 21;
// 0 = complete, 1 = partial, 2 = missed, 3 = rest
const PATTERN = [0, 0, 0, 1, 0, 0, 3, 0, 0, 2, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 1];

async function main() {
  await migrate();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate();
  await tx((c) => loadProblemPool(c));
  const now = Date.now();
  const start = new Date(dayStart(addDays(dayKey(now), -DAYS)));
  const uid = await tx((c) => seedOwner(c, start));
  await tx(async (c) => {
    await c.query(`update users set target_date='2027-03-31' where id=$1`, [uid]);
    await c.query('delete from score_snapshots where user_id=$1', [uid]);
    await c.query('delete from daily_objectives where user_id=$1', [uid]);
    let score = 12604;
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(dayKey(now), -(DAYS - i));
      const kind = PATTERN[i];
      const gain = kind === 0 ? 34 + (i % 4) * 6 : kind === 1 ? 12 : 0;
      score += gain;
      const at = new Date(dayStart(date) + 14 * 3_600_000);
      if (gain) {
        await c.query(
          `insert into score_snapshots(user_id, overall_score, leetcode_score, codechef_score, codeforces_score, smart_interviews_score, interviewbit_score, hackerrank_score, captured_at)
           values ($1,$2,2102,1100,392,7976,908,126,$3)`, [uid, score, at]);
      }
      const status = ['COMPLETE', 'PARTIAL', 'MISSED', 'REST'][kind];
      const o = (await c.query(
        `insert into daily_objectives(user_id, date, target_score_delta, status, trajectory_status, is_rest, rationale_json, score_at_start, score_at_close, completed_at)
         values ($1,$2,$3,$4,'ON PACE',$5,'[]',$6,$7,$8) returning id`,
        [uid, date, kind === 3 ? 0 : 34, status, kind === 3, score - gain, score, kind === 0 ? at : null])).rows[0];
      if (kind !== 3) {
        const items: [string, number, number][] = [['leetcode', 2, kind === 2 ? 0 : kind === 1 ? 1 : 2], ['codechef', 1, kind === 0 ? 1 : 0]];
        let pos = 0;
        for (const [p, quota, done] of items) {
          await c.query(
            `insert into daily_objective_items(objective_id, position, type, platform, title, reason, required, quota, completed_count, completed, verification, minutes, points)
             values ($1,$2,'PROBLEM_QUOTA',$3,$4,'demo',true,$5,$6,$7,$8,60,$9)`,
            [o.id, pos++, p, p === 'leetcode' ? 'LeetCode' : 'CodeChef', quota, done, done >= quota, done > 0 ? 'VERIFIED' : 'PENDING', quota * 10]);
        }
        await c.query(`insert into activity_events(user_id, event_type, source_id, payload_json, created_at) values ($1,'DAILY_OBJECTIVE_CREATED',$2,'{"demo":true}',$3)`, [uid, date, at]);
      }
    }
    // a rated contest attended with rating movement, for analytics
    const k = (await c.query(
      `insert into contests(platform, external_contest_id, title, start_at, end_at, rated) values ('codechef','demo-s1','Starters [DEMO]',$1,$2,true) returning id`,
      [new Date(now - 6 * 86_400_000), new Date(now - 6 * 86_400_000 + 7_200_000)])).rows[0];
    await c.query(`insert into contest_participations(user_id, platform, contest_id, rating_before, rating_after, rating_delta, source) values ($1,'codechef',$2,1135,1163,28,'SYNC')`, [uid, k.id]);
    await c.query(`insert into rating_history(user_id, platform, rating, recorded_at) values ($1,'codechef',1163,$2)`, [uid, new Date(now - 6 * 86_400_000 + 9_000_000)]);
    await c.query(`update platform_stats set rating=1163 where user_id=$1 and platform='codechef'`, [uid]);
    await seedDevContests(c, uid, now);
  });
  console.log('demo history written (21 days, tagged demo)');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
