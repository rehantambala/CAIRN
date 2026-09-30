import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { migrate } from './migrate.js';
import { pool, tx } from './pool.js';
import type { Db } from './pool.js';
import { upsertContest } from '../services/contests.js';
import { refreshAfterChange } from '../services/pipeline.js';
import { recordEvent } from '../services/state.js';

/**
 * DEVELOPMENT SEED. The 12,604 state below is the user's known baseline from the Smart
 * Interviews leaderboard, loaded as data. No business logic reads these constants.
 */
export const BASELINE_SEED = {
  leetcode: { problems: 72, rating: 1373, contests: 17 },
  codechef: { problems: 125, rating: 1135, contests: 17 },
  codeforces: { problems: 10, rating: 835, contests: 5 },
  contributions: { hackerrank: 126, smartinterviews: 7976, interviewbit: 908 },
} as const;

export async function loadProblemPool(db: Db) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const rows = JSON.parse(readFileSync(join(dir, '..', 'data', 'problems.json'), 'utf8')) as any[];
  for (const p of rows) {
    await db.query(
      `insert into problems(platform, external_problem_id, title, url, difficulty, topic)
       values ($1,$2,$3,$4,$5,$6) on conflict (platform, external_problem_id) do update set title=excluded.title, url=excluded.url,
         difficulty=coalesce(excluded.difficulty, problems.difficulty), topic=coalesce(excluded.topic, problems.topic)`,
      [p.platform, p.externalId, p.title, p.url, p.difficulty, p.topic],
    );
  }
  return rows.length;
}

export async function seedOwner(db: Db, now = new Date()): Promise<string> {
  const existing = (await db.query('select id from users where email=$1', [config.ownerEmail])).rows[0];
  if (existing) return existing.id;
  const hash = await bcrypt.hash(config.ownerPassword, 10);
  const u = (await db.query(
    `insert into users(email, password_hash, display_name) values ($1,$2,'Owner') returning id`, [config.ownerEmail, hash],
  )).rows[0];
  const uid: string = u.id;
  const B = BASELINE_SEED;
  const rows: [string, number | null, number, number, number | null, string, string][] = [
    ['leetcode', B.leetcode.rating, B.leetcode.problems, B.leetcode.contests, null, 'MANUAL', 'Seed baseline'],
    ['codechef', B.codechef.rating, B.codechef.problems, B.codechef.contests, null, 'MANUAL', 'Seed baseline'],
    ['codeforces', B.codeforces.rating, B.codeforces.problems, B.codeforces.contests, null, 'MANUAL', 'Seed baseline'],
    ['smartinterviews', null, 0, 0, B.contributions.smartinterviews, 'MANUAL', 'Smart Interviews leaderboard'],
    ['interviewbit', null, 0, 0, B.contributions.interviewbit, 'MANUAL', 'Entered by owner'],
    ['hackerrank', null, 0, 0, B.contributions.hackerrank, 'MANUAL', 'Entered by owner'],
  ];
  for (const [platform, rating, problems, contests, contribution, status, note] of rows) {
    await db.query(
      `insert into platform_stats(user_id, platform, base_problems, base_contests, base_as_of, rating, contribution, source_status, source_note, last_updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5)`,
      [uid, platform, problems, contests, now, rating, contribution, status, note],
    );
    if (rating !== null) {
      await db.query('insert into rating_history(user_id, platform, rating, recorded_at) values ($1,$2,$3,$4)', [uid, platform, rating, now]);
    }
    await db.query(
      `insert into platform_accounts(user_id, platform, username, connection_status) values ($1,$2,'', 'DISCONNECTED')`,
      [uid, platform],
    );
  }
  await recordEvent(db, uid, 'PLATFORM_SYNCED', null, null, { seed: true });
  await refreshAfterChange(db, uid, now.getTime(), 'seed');
  return uid;
}

/** Contests generated relative to "now", clearly labelled. Never part of the default seed. */
export async function seedDevContests(db: Db, userId: string, now = Date.now()) {
  const H = 3_600_000;
  const mk = (platform: any, id: string, title: string, inH: number, durH: number) => upsertContest(db, userId, {
    platform, externalContestId: `dev-${id}`, title: `${title} [DEV SEED]`,
    startAt: new Date(now + inH * H), endAt: new Date(now + (inH + durH) * H),
    contestUrl: null, registrationUrl: null, rated: true,
  });
  await mk('codechef', 'cc1', 'Starters', 0.9, 2);
  await mk('leetcode', 'lc1', 'Weekly Contest', 30, 1.5);
  await mk('codeforces', 'cf1', 'Round', 78, 2);
  await mk('codechef', 'cc2', 'Starters', 150, 2);
}

async function main() {
  await migrate();
  const n = await tx(async (c) => loadProblemPool(c));
  const uid = await tx(async (c) => seedOwner(c));
  if (process.env.SEED_DEV_CONTESTS === '1') await tx(async (c) => seedDevContests(c, uid));
  console.log(`seeded owner ${config.ownerEmail}, ${n} problems${process.env.SEED_DEV_CONTESTS === '1' ? ', dev contests' : ''}`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
