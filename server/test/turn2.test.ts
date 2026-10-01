import { describe, expect, it } from 'vitest';
import { extractHandles, discoverFromGitHub } from '../src/services/accounts.js';
import { parseCodeforcesProblems, parseLeetCodeProblems } from '../src/services/pool.js';
import { buildBrief, contestPlan } from '../src/domain/brief.js';
import { suggestionGuidance } from '../src/domain/objective.js';

describe('handle discovery', () => {
  it('extracts handles from profile addresses and ignores reserved paths', () => {
    const h = extractHandles([
      'Solving at https://leetcode.com/u/ada_l/ and https://www.codechef.com/users/ada_cc',
      'https://leetcode.com/problems/two-sum/ https://codeforces.com/profile/AdaCF',
    ]);
    expect(h).toEqual({ leetcode: 'ada_l', codechef: 'ada_cc', codeforces: 'AdaCF' });
  });
  it('returns nothing from unrelated text', () => { expect(extractHandles(['hello', null, undefined])).toEqual({}); });
  it('reads bio, social accounts and README; a failing source does not abort the rest', async () => {
    const get = async (url: string) => {
      if (url.endsWith('/social_accounts')) return [{ url: 'https://codeforces.com/profile/zed' }];
      if (url.includes('/readme')) throw new Error('404');
      return { bio: 'leetcode.com/u/zed1', blog: '' };
    };
    expect(await discoverFromGitHub('zed', get as any)).toEqual({ leetcode: 'zed1', codeforces: 'zed' });
  });
});

describe('pool parsers', () => {
  it('keeps rated Codeforces problems in range, newest first', () => {
    const rows = parseCodeforcesProblems({ status: 'OK', result: { problems: [
      { contestId: 1, index: 'A', name: 'Old', rating: 800 },
      { contestId: 9, index: 'B', name: 'New', rating: 1200, tags: ['dp'] },
      { contestId: 9, index: 'E', name: 'Hard', rating: 2400 },
      { index: 'A', name: 'NoContest', rating: 900 },
    ] } });
    expect(rows.map((r) => r.externalId)).toEqual(['9B', '1A']);
    expect(rows[0].url).toBe('https://codeforces.com/problemset/problem/9/B');
  });
  it('drops paid LeetCode questions', () => {
    const rows = parseLeetCodeProblems({ data: { problemsetQuestionList: { questions: [
      { title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', isPaidOnly: false, topicTags: [{ name: 'Array' }] },
      { title: 'Locked', titleSlug: 'locked', difficulty: 'Hard', isPaidOnly: true },
    ] } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://leetcode.com/problems/two-sum/');
  });
});

describe('brief', () => {
  const items = [
    { type: 'PROBLEM_QUOTA', platform: 'leetcode' as const, required: true, quota: 2, completedCount: 0, completed: false, points: 20, minutes: 50, title: 'LeetCode' },
    { type: 'PROBLEM_QUOTA', platform: 'codeforces' as const, required: true, quota: 1, completedCount: 0, completed: false, points: 20, minutes: 40, title: 'Codeforces' },
  ];
  it('accumulates points platform by platform and states the milestone consequence', () => {
    const b = buildBrief({ items, scoreNow: 12_604, milestone: 15_000, now: Date.UTC(2026, 9, 1, 12), tz: 'Asia/Kolkata', date: '2026-10-01', isRest: false });
    expect(b.steps.map((s) => s.scoreAfter)).toEqual([12_624, 12_644]);
    expect(b.gain).toBe(40);
    expect(b.minutes).toBe(90);
    expect(b.daysAtThisRate).toBe(Math.ceil(2396 / 40));
    expect(b.mostEfficient?.label).toBe('Codeforces');
  });
  it('reduces remaining work by progress already made', () => {
    const b = buildBrief({ items: [{ ...items[0], completedCount: 1 }], scoreNow: 100, milestone: null, now: 0, tz: 'UTC', date: '2026-10-01', isRest: false });
    expect(b.steps[0]).toMatchObject({ remaining: 1, points: 10 });
  });
  it('is empty on a rest day', () => {
    expect(buildBrief({ items, scoreNow: 1, milestone: null, now: 0, tz: 'UTC', date: '2026-10-01', isRest: true }).steps).toEqual([]);
  });
});

describe('contest plan', () => {
  const start = Date.UTC(2026, 9, 1, 14, 30);
  it('plans only rated platforms and places warm-up before the start', () => {
    expect(contestPlan({ platform: 'hackerrank', startAt: start, prepMinutes: 30, rating: null, pool: [], solved: new Set(), date: '2026-10-01' })).toBeNull();
    const p = contestPlan({ platform: 'codechef', startAt: start, prepMinutes: 30, rating: 1400, pool: [], solved: new Set(), date: '2026-10-01' })!;
    expect(p.perContest).toBe(50);
    expect(p.warmupBeginsAt).toBe(start - 90 * 60_000);
    expect(p.attempt).toBeGreaterThanOrEqual(2);
  });
});

describe('suggestion guidance', () => {
  it('is defined for any count', () => { expect(typeof suggestionGuidance(0, 2, 1200)).toBe('string'); });
});
