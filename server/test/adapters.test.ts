import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLeetCodeAdapter, parseLeetCode } from '../src/adapters/leetcode.js';
import { createCodeChefAdapter, parseCodeChef } from '../src/adapters/codechef.js';
import { syncPlatform } from '../src/services/sync.js';
import { loadScore } from '../src/services/state.js';
import { freshDb, pool, SEED_NOW } from './db-helper.js';

const NOW = SEED_NOW.getTime() + 3_600_000;
const ts = (mins: number) => String(Math.floor((NOW + mins * 60_000) / 1000));

const lc = (solved: number, rating: number | null, contests = 17) => ({
  data: {
    matchedUser: { username: 'tester', submitStatsGlobal: { acSubmissionNum: [
      { difficulty: 'All', count: solved }, { difficulty: 'Easy', count: 40 }, { difficulty: 'Medium', count: 30 }, { difficulty: 'Hard', count: 2 }] } },
    userContestRanking: rating === null ? null : { attendedContestsCount: contests, rating: rating + 0.4 },
    recentAcSubmissionList: [
      { id: '9001', title: 'Two Sum', titleSlug: 'two-sum', timestamp: ts(-30) },
      { id: '9002', title: 'Two Sum', titleSlug: 'two-sum', timestamp: ts(-20) },
      { id: '9003', title: 'Valid Parentheses', titleSlug: 'valid-parentheses', timestamp: ts(-10) },
    ],
  },
});

const ccPage = (solved: number, rating: number, contests: number) => `
<html><body><div class="rating-number">${rating}</div>
<section class="rating-data-section problems-solved"><h3>Total Problems Solved: ${solved}</h3></section>
<div><span>No. of Contests Participated:</span> <b>${contests}</b></div></body></html>`;

beforeEach(async () => { await freshDb(); });
afterAll(async () => { await pool.end(); });

describe('LeetCode adapter', () => {
  it('parses totals, rating and recent acceptances', () => {
    const r = parseLeetCode(lc(75, 1401));
    expect(r.totals).toEqual({ problems: 75, contests: 17, rating: 1401 });
    expect(r.recent).toHaveLength(3);
    expect(r.recent[0].url).toBe('https://leetcode.com/problems/two-sum/');
  });
  it('treats a profile with no contests as rating null', () => {
    expect(parseLeetCode(lc(10, null)).totals).toEqual({ problems: 10, contests: 0, rating: null });
  });
  it('rejects unknown handles and malformed payloads', () => {
    expect(() => parseLeetCode({ data: { matchedUser: null } })).toThrow(/no public profile/i);
    expect(() => parseLeetCode({ errors: [{ message: 'rate limited' }] })).toThrow(/rate limited/);
    expect(() => parseLeetCode({ nonsense: 1 })).toThrow();
  });
});

describe('CodeChef adapter', () => {
  it('parses the labelled figures from the profile page', () => {
    expect(parseCodeChef(ccPage(131, 1187, 19))).toEqual({ problems: 131, contests: 19, rating: 1187 });
  });
  it('fails loudly rather than guessing when the page changes', () => {
    expect(() => parseCodeChef('<html><body>redesigned</body></html>')).toThrow(/solved total/);
  });
});

describe('live sync of LeetCode and CodeChef', () => {
  const uidOf = async () => (await pool.query('select id from users')).rows[0].id as string;

  it('replaces the baseline with the platform totals and recalculates the score exactly', async () => {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='leetcode'`);
    const uid = await uidOf();
    const before = (await loadScore(pool, uid)).score;
    expect(before.overall).toBe(12604);

    const adapter = createLeetCodeAdapter(async () => lc(75, 1401, 18));
    const r = await syncPlatform(uid, 'leetcode', NOW, adapter);
    expect(r.ok).toBe(true);

    const { stats, score } = await loadScore(pool, uid);
    const s = stats.find((x) => x.platform === 'leetcode')!;
    expect([s.problems, s.rating, s.contests]).toEqual([75, 1401, 18]);
    // floor(75*10 + (101^2)/10 + 18*50) = floor(750 + 1020.1 + 900) = 2670
    expect(score.leetcode.total).toBe(2670);
    expect(score.overall).toBe(12604 - 2102 + 2670);
    expect(s.sourceStatus).toBe('SYNCED');
  });

  it('is idempotent and does not double count', async () => {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='leetcode'`);
    const uid = await uidOf();
    const adapter = createLeetCodeAdapter(async () => lc(75, 1401));
    await syncPlatform(uid, 'leetcode', NOW, adapter);
    const a = (await loadScore(pool, uid)).score.overall;
    await syncPlatform(uid, 'leetcode', NOW + 600_000, createLeetCodeAdapter(async () => lc(75, 1401)));
    expect((await loadScore(pool, uid)).score.overall).toBe(a);
  });

  it('counts a newly accepted problem once: the platform total moves by one', async () => {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='leetcode'`);
    const uid = await uidOf();
    await syncPlatform(uid, 'leetcode', NOW, createLeetCodeAdapter(async () => lc(75, 1401)));
    const a = (await loadScore(pool, uid)).score.overall;
    await syncPlatform(uid, 'leetcode', NOW + 600_000, createLeetCodeAdapter(async () => lc(76, 1401)));
    expect((await loadScore(pool, uid)).score.overall).toBe(a + 10);
  });

  it('syncs CodeChef totals and leaves every other platform untouched', async () => {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='codechef'`);
    const uid = await uidOf();
    const r = await syncPlatform(uid, 'codechef', NOW, createCodeChefAdapter(async () => ccPage(131, 1187, 19)));
    expect(r.ok).toBe(true);
    const { stats, score } = await loadScore(pool, uid);
    const cc = stats.find((x) => x.platform === 'codechef')!;
    expect([cc.problems, cc.rating, cc.contests]).toEqual([131, 1187, 19]);
    expect(stats.find((x) => x.platform === 'leetcode')!.problems).toBe(72);
    expect(score.leetcode.total).toBe(2102);
    expect(score.codeforces.total).toBe(392);
  });

  it('keeps the stored figures and reports ERROR when the platform cannot be read', async () => {
    await pool.query(`update platform_accounts set username='tester', connection_status='CONNECTED' where platform='codechef'`);
    const uid = await uidOf();
    const r = await syncPlatform(uid, 'codechef', NOW, createCodeChefAdapter(async () => '<html>blocked</html>'));
    expect(r.ok).toBe(false);
    const { stats, score } = await loadScore(pool, uid);
    expect(score.overall).toBe(12604);
    expect(stats.find((x) => x.platform === 'codechef')!.sourceStatus).toBe('ERROR');
  });
});
