import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, pool, SEED_NOW, tx } from './db-helper.js';
import { loadScore } from '../src/services/state.js';
import { processAccepted, ingestAccepted } from '../src/services/pipeline.js';
import { recordParticipation, recordRating, upsertContest } from '../src/services/contests.js';
import { refreshAfterChange } from '../src/services/pipeline.js';
import { closePastDays, ensureObjective, loadObjectives, loadSnapshots } from '../src/services/derived.js';
import { scheduleAll, deliverDue } from '../src/services/notify.js';
import { runJob } from '../src/services/jobs.js';
import { computeToday } from '../src/services/today.js';

let uid: string;
const NOW = SEED_NOW.getTime() + 3_600_000; // 11:00 IST, same local day as the seed
const at = (mins: number) => new Date(NOW + mins * 60_000);

beforeEach(async () => { uid = await freshDb(); });
afterAll(async () => { await pool.end(); });

const accept = (platform: any, id: string, source: 'SYNC' | 'IMPORT' | 'MANUAL' = 'SYNC', sub?: string) =>
  processAccepted(uid, { platform, externalProblemId: id, externalSubmissionId: sub ?? null, acceptedAt: at(5), source }, NOW);

describe('seeded baseline', () => {
  it('loads from the database and verifies at 12,604', async () => {
    const { score } = await loadScore(pool, uid);
    expect(score.overall).toBe(12604);
    expect(score.codechef.total).toBe(1100);
    const snaps = await loadSnapshots(pool, uid);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].score).toBe(12604);
  });
});

describe('accepted-problem pipeline', () => {
  it('new LeetCode problem: LCPS 73, score recalculated, snapshot written', async () => {
    const r = await accept('leetcode', 'two-sum', 'SYNC', 'lc-1');
    expect(r.isNew).toBe(true);
    const { stats, score } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'leetcode')!.problems).toBe(73);
    expect(score.overall).toBe(12614);
    expect((await loadSnapshots(pool, uid)).map((s) => s.score)).toEqual([12604, 12614]);
  });

  it('the same accepted problem detected again does not increment', async () => {
    await accept('leetcode', 'two-sum', 'SYNC', 'lc-1');
    const again = await accept('leetcode', 'two-sum', 'SYNC', 'lc-1');
    const other = await accept('leetcode', 'two-sum', 'SYNC', 'lc-2'); // a later accepted re-submission
    expect(again.isNew).toBe(false);
    expect(other.isNew).toBe(false);
    const { stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'leetcode')!.problems).toBe(73);
    expect((await loadSnapshots(pool, uid))).toHaveLength(2); // no extra snapshot
  });

  it('CodeChef accepted only affects CodeChef (+2)', async () => {
    await accept('codechef', 'FLOW001');
    const { score, stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'codechef')!.problems).toBe(126);
    expect(stats.find((s) => s.platform === 'leetcode')!.problems).toBe(72);
    expect(score.overall).toBe(12606);
  });

  it('Codeforces accepted only affects Codeforces (+2)', async () => {
    await accept('codeforces', '4A');
    const { score, stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'codeforces')!.problems).toBe(11);
    expect(score.overall).toBe(12606);
  });

  it('the same problem on different platforms counts separately', async () => {
    await accept('leetcode', 'binary-search');
    await accept('codeforces', 'binary-search');
    const { stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'leetcode')!.problems).toBe(73);
    expect(stats.find((s) => s.platform === 'codeforces')!.problems).toBe(11);
  });

  it('historic acceptances before the baseline are remembered but not double counted', async () => {
    await processAccepted(uid, { platform: 'codeforces', externalProblemId: '1A', acceptedAt: new Date('2020-01-01'), source: 'SYNC' }, NOW);
    const { stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'codeforces')!.problems).toBe(10);
    const dup = await ingestAccepted(pool, uid, { platform: 'codeforces', externalProblemId: '1A', acceptedAt: new Date('2020-01-01'), source: 'SYNC' });
    expect(dup.isNew).toBe(false);
  });
});

describe('rating and contests', () => {
  it('a rating update recalculates the formula', async () => {
    await tx(async (c) => {
      await recordRating(c, uid, 'codechef', 1300, at(10), 'START1');
      await refreshAfterChange(c, uid, NOW, 'rating');
    });
    const { score } = await loadScore(pool, uid);
    expect(score.codechef.total).toBe(2100);
  });

  it('participation adds NC +1 exactly once, and contest upserts dedupe', async () => {
    const id = await tx(async (c) => {
      const a = await upsertContest(c, uid, { platform: 'leetcode', externalContestId: 'weekly-1', title: 'Weekly 1', startAt: at(-120), endAt: at(-30) });
      const b = await upsertContest(c, uid, { platform: 'leetcode', externalContestId: 'weekly-1', title: 'Weekly 1', startAt: at(-120), endAt: at(-30) });
      expect(b.id).toBe(a.id);
      expect(b.isNew).toBe(false);
      await recordParticipation(c, uid, 'leetcode', a.id, { ratingBefore: 1373, ratingAfter: 1390, source: 'SYNC' });
      await recordParticipation(c, uid, 'leetcode', a.id, { ratingBefore: 1373, ratingAfter: 1390, source: 'SYNC' });
      return a.id;
    });
    const { stats } = await loadScore(pool, uid);
    expect(stats.find((s) => s.platform === 'leetcode')!.contests).toBe(18);
    expect((await pool.query('select count(*)::int n from contests where id=$1', [id])).rows[0].n).toBe(1);
  });
});

describe('daily objective and calendar', () => {
  it('generates an objective from state with real suggestions and no solved problems', async () => {
    const o = await ensureObjective(pool, uid, NOW);
    expect(o.items.length).toBeGreaterThan(0);
    expect(o.items.every((i) => i.required || i.type !== 'PROBLEM_QUOTA')).toBe(true);
    const again = await ensureObjective(pool, uid, NOW);
    expect(again.id).toBe(o.id); // idempotent
  });

  it('auto-completes quota items from verified acceptances and completes the day', async () => {
    const o = await ensureObjective(pool, uid, NOW);
    const quotas = o.items.filter((i) => i.type === 'PROBLEM_QUOTA');
    let n = 0;
    for (const q of quotas) {
      for (let k = 0; k < q.quota; k++) await accept(q.platform!, `verified-${q.platform}-${k}`, 'SYNC', `s-${n++}`);
    }
    const day = (await loadObjectives(pool, uid, '2026-09-30', '2026-09-30'))[0];
    expect(day.status).toBe('COMPLETE');
    expect(day.items.filter((i) => i.required).every((i) => i.completed && i.verification === 'VERIFIED')).toBe(true);
    const t = await computeToday(pool, uid, NOW);
    expect(t.next.kind).not.toBe('ITEM');
    const completeEvents = (await pool.query(`select count(*)::int n from activity_events where event_type='DAILY_OBJECTIVE_COMPLETED'`)).rows[0].n;
    expect(completeEvents).toBe(1);
  });

  it('manual completion is recorded as MANUAL, not VERIFIED', async () => {
    const o = await ensureObjective(pool, uid, NOW);
    const q = o.items.find((i) => i.type === 'PROBLEM_QUOTA')!;
    for (let k = 0; k < q.quota; k++) await accept(q.platform!, `manual-${k}`, 'MANUAL');
    const day = (await loadObjectives(pool, uid, '2026-09-30', '2026-09-30'))[0];
    const item = day.items.find((i) => i.id === q.id)!;
    expect(item.completed).toBe(true);
    expect(item.verification).toBe('MANUAL');
  });

  it('a past day with nothing done closes as MISSED; closing twice changes nothing', async () => {
    await ensureObjective(pool, uid, NOW);
    const tomorrow = NOW + 86_400_000;
    expect(await closePastDays(pool, uid, tomorrow)).toBe(1);
    expect(await closePastDays(pool, uid, tomorrow)).toBe(0);
    const day = (await loadObjectives(pool, uid, '2026-09-30', '2026-09-30'))[0];
    expect(day.status).toBe('MISSED');
    const missed = (await pool.query(`select count(*)::int n from activity_events where event_type='DAILY_OBJECTIVE_MISSED'`)).rows[0].n;
    expect(missed).toBe(1);
  });
});

describe('jobs and notifications', () => {
  it('reminder scheduling and delivery are idempotent and tolerate delay', async () => {
    const start = NOW + 26 * 3_600_000;
    await tx(async (c) => {
      const k = await upsertContest(c, uid, { platform: 'codechef', externalContestId: 'S1', title: 'Starters', startAt: new Date(start), endAt: new Date(start + 2 * 3_600_000) });
      await c.query('insert into contest_commitments(user_id, contest_id) values ($1,$2)', [uid, k.id]);
    });
    const first = await tx((c) => scheduleAll(c, uid, NOW));
    const second = await tx((c) => scheduleAll(c, uid, NOW));
    expect(first).toBe(4);
    expect(second).toBe(0);
    // job runs 20 minutes late: the 24h slot is due and delivered once; nothing is duplicated
    const late = NOW + 3_600_000 * 2 + 20 * 60_000;
    const d1 = await tx((c) => deliverDue(c, uid, late));
    const d2 = await tx((c) => deliverDue(c, uid, late));
    expect(d1.due).toBe(1);
    expect(d2.due).toBe(0);
    // with no push configured nothing is claimed as delivered
    const rows = (await pool.query('select status, payload_json from notifications order by scheduled_for')).rows;
    expect(rows[0].status).toBe('SKIPPED');
    expect(rows[0].payload_json.reason).toBe('PUSH_NOT_CONFIGURED');
  });

  it('expired reminders are skipped, never sent stale', async () => {
    const start = NOW + 26 * 3_600_000;
    await tx(async (c) => {
      const k = await upsertContest(c, uid, { platform: 'codechef', externalContestId: 'S2', title: 'Starters', startAt: new Date(start), endAt: new Date(start + 7_200_000) });
      await c.query('insert into contest_commitments(user_id, contest_id) values ($1,$2)', [uid, k.id]);
    });
    await tx((c) => scheduleAll(c, uid, NOW));
    const afterStart = start + 30 * 60_000;
    const r = await tx((c) => deliverDue(c, uid, afterStart));
    expect(r.skipped).toBe(r.due);
    const expired = (await pool.query(`select count(*)::int n from notifications where payload_json->>'reason'='EXPIRED'`)).rows[0].n;
    expect(expired).toBe(3); // 24h, 1h, 10m
  });

  it('rollover job is idempotent', async () => {
    await runJob('rollover', NOW);
    const a = (await pool.query('select count(*)::int n from score_snapshots')).rows[0].n;
    await runJob('rollover', NOW);
    const b = (await pool.query('select count(*)::int n from score_snapshots')).rows[0].n;
    expect(b).toBe(a);
    expect((await pool.query('select count(*)::int n from daily_objectives')).rows[0].n).toBe(1);
  });
});
