import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCodeforcesAdapter, normalizeContest, normalizeSubmission } from '../src/adapters/codeforces.js';
import { normalizeClist } from '../src/adapters/clist.js';
import { syncPlatform } from '../src/services/sync.js';
import { loadScore } from '../src/services/state.js';
import { freshDb, pool, SEED_NOW } from './db-helper.js';

// Shapes follow the official Codeforces API (https://codeforces.com/apiHelp).
const NOW = SEED_NOW.getTime() + 3_600_000;
const t = (mins: number) => Math.floor((NOW + mins * 60_000) / 1000);

const fixtures = {
  'user.info': { status: 'OK', result: [{ handle: 'tester', rating: 861, maxRating: 861 }] },
  'user.status': {
    status: 'OK',
    result: [
      { id: 101, contestId: 4, creationTimeSeconds: t(1), verdict: 'OK', participantType: 'PRACTICE', problem: { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['math'] } },
      { id: 102, contestId: 4, creationTimeSeconds: t(2), verdict: 'OK', participantType: 'PRACTICE', problem: { contestId: 4, index: 'A', name: 'Watermelon', rating: 800 } }, // resubmission
      { id: 103, contestId: 71, creationTimeSeconds: t(3), verdict: 'WRONG_ANSWER', participantType: 'PRACTICE', problem: { contestId: 71, index: 'A', name: 'Way Too Long Words', rating: 800 } },
      { id: 104, contestId: 9001, creationTimeSeconds: t(-40), verdict: 'OK', participantType: 'CONTESTANT', problem: { contestId: 9001, index: 'B', name: 'In Contest', rating: 1100 } },
      { id: 105, creationTimeSeconds: t(4), verdict: 'OK', participantType: 'PRACTICE', problem: { index: 'Z', name: 'No Contest Id' } }, // unidentifiable, ignored
    ],
  },
  'user.rating': {
    status: 'OK',
    result: [{ contestId: 9001, contestName: 'Test Round', ratingUpdateTimeSeconds: t(-10), oldRating: 835, newRating: 861 }],
  },
  'contest.list': {
    status: 'OK',
    result: [
      { id: 9001, name: 'Test Round', type: 'CF', phase: 'FINISHED', durationSeconds: 7200, startTimeSeconds: t(-160) },
      { id: 9002, name: 'Future Round', type: 'CF', phase: 'BEFORE', durationSeconds: 7200, startTimeSeconds: t(5000) },
      { id: 9003, name: 'No start', type: 'CF', phase: 'BEFORE', durationSeconds: 7200 },
    ],
  },
};

function fakeFetch(fail = false) {
  return async (url: string) => {
    if (fail) throw new Error('network down');
    const key = Object.keys(fixtures).find((k) => url.includes(`/api/${k}`))!;
    return (fixtures as any)[key];
  };
}

beforeEach(async () => { await freshDb(); });
afterAll(async () => { await pool.end(); });

describe('Codeforces adapter normalization', () => {
  it('normalizes accepted, rejected and unidentifiable submissions', () => {
    const ok = normalizeSubmission(fixtures['user.status'].result[0] as any)!;
    expect(ok.externalProblemId).toBe('4A');
    expect(ok.accepted).toBe(true);
    expect(ok.url).toBe('https://codeforces.com/problemset/problem/4/A');
    expect(normalizeSubmission(fixtures['user.status'].result[2] as any)!.accepted).toBe(false);
    expect(normalizeSubmission(fixtures['user.status'].result[4] as any)).toBeNull();
  });
  it('normalizes contests and drops entries without a start time', () => {
    expect(normalizeContest(fixtures['contest.list'].result[2] as any)).toBeNull();
    const c = normalizeContest(fixtures['contest.list'].result[1] as any)!;
    expect(c.phase).toBe('UPCOMING');
    expect(c.rated).toBe(true);
    expect(c.contestUrl).toBe('https://codeforces.com/contest/9002');
  });
  it('rejects malformed payloads instead of trusting them', async () => {
    const a = createCodeforcesAdapter(async () => ({ status: 'OK', result: [{ nonsense: true }] }));
    await expect(a.getSubmissions!('x')).rejects.toThrow();
    const f = createCodeforcesAdapter(async () => ({ status: 'FAILED', comment: 'handle not found' }));
    await expect(f.getProfile!('x')).rejects.toThrow(/handle not found/);
  });
  it('clist normalization maps hosts and drops Codeforces and bad dates', () => {
    const base = { id: 1, event: 'Weekly 1', href: 'https://leetcode.com/contest/weekly-contest-1', start: '2026-10-04T02:30:00', end: '2026-10-04T04:00:00' };
    expect(normalizeClist({ ...base, host: 'leetcode.com' })!.platform).toBe('leetcode');
    expect(normalizeClist({ ...base, host: 'codeforces.com' })).toBeNull();
    expect(normalizeClist({ ...base, host: 'leetcode.com', start: 'garbage' })).toBeNull();
    expect(normalizeClist({ ...base, host: 'leetcode.com' })!.startAt.toISOString()).toBe('2026-10-04T02:30:00.000Z');
  });
});

describe('Codeforces sync into the pipeline', () => {
  async function connect() {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='codeforces'`);
  }

  it('syncs once: dedupes resubmissions, records participation, rating, and is idempotent', async () => {
    await connect();
    const adapter = createCodeforcesAdapter(fakeFetch());
    const first = await syncPlatform((await pool.query('select id from users')).rows[0].id, 'codeforces', NOW, adapter);
    expect(first.ok).toBe(true);
    expect(first.newProblems).toBe(2); // 4A (once, despite two accepted submissions) and 9001B
    const uid = (await pool.query('select id from users')).rows[0].id;
    const a = await loadScore(pool, uid);
    const cf = a.stats.find((s) => s.platform === 'codeforces')!;
    expect(cf.problems).toBe(2); // the platform history is authoritative: 4A and 9001B, each once
    expect(cf.rating).toBe(861);
    expect(cf.contests).toBe(1); // participation in 9001 counted once (submission proof + rating update merged)
    expect(cf.sourceStatus).toBe('LIVE');

    const second = await syncPlatform(uid, 'codeforces', NOW, adapter);
    expect(second.newProblems).toBe(0);
    expect(second.newParticipations).toBe(0);
    const b = await loadScore(pool, uid);
    expect(b.score.overall).toBe(a.score.overall);
    expect((await pool.query('select count(*)::int n from score_snapshots')).rows[0].n).toBe(2);
  });

  it('on failure keeps existing data, reports ERROR, and never overwrites with nothing', async () => {
    await connect();
    const uid = (await pool.query('select id from users')).rows[0].id;
    const before = (await loadScore(pool, uid)).score.overall;
    const r = await syncPlatform(uid, 'codeforces', NOW, createCodeforcesAdapter(fakeFetch(true)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Synchronisation failed/);
    const { stats, score } = await loadScore(pool, uid);
    expect(score.overall).toBe(before);
    expect(stats.find((s) => s.platform === 'codeforces')!.sourceStatus).toBe('ERROR');
  });

  it('refuses politely when the handle is not connected', async () => {
    const uid = (await pool.query('select id from users')).rows[0].id;
    const r = await syncPlatform(uid, 'codeforces', NOW, createCodeforcesAdapter(fakeFetch()));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not connected/);
  });
});
