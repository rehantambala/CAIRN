import { describe, expect, it } from 'vitest';
import { computeScore, ratedBreakdown, ratingEffect, reachability, marginal } from '../src/domain/score.js';
import { BASELINE } from './fixtures.js';

describe('score engine', () => {
  it('reproduces the 12,604 baseline and each platform total', () => {
    const s = computeScore(BASELINE);
    expect(s.leetcode.total).toBe(2102);
    expect(s.codechef.total).toBe(1100);
    expect(s.codeforces.total).toBe(392);
    expect(s.overall).toBe(12604);
  });

  it('clamps the rating term at zero below the platform baseline', () => {
    expect(ratedBreakdown('codechef', { problems: 0, rating: 1000, contests: 0 }).ratingPoints).toBe(0);
    expect(ratedBreakdown('leetcode', { problems: 0, rating: 1200, contests: 0 }).ratingPoints).toBe(0);
    expect(ratedBreakdown('codeforces', { problems: 0, rating: 700, contests: 0 }).ratingPoints).toBe(0);
  });

  it('one new LeetCode accepted problem: LCPS 73, +10', () => {
    const next = { ...BASELINE, leetcode: { ...BASELINE.leetcode, problems: 73 } };
    const s = computeScore(next);
    expect(s.leetcode.total).toBe(2112);
    expect(s.overall).toBe(12614);
  });

  it('CodeChef and Codeforces problems add +2 and touch only their platform', () => {
    const cc = computeScore({ ...BASELINE, codechef: { ...BASELINE.codechef, problems: 126 } });
    expect(cc.codechef.total).toBe(1102);
    expect(cc.leetcode.total).toBe(2102);
    const cf = computeScore({ ...BASELINE, codeforces: { ...BASELINE.codeforces, problems: 11 } });
    expect(cf.codeforces.total).toBe(394);
    expect(cf.codechef.total).toBe(1100);
  });

  it('rating update recalculates via the formula', () => {
    const cc = computeScore({ ...BASELINE, codechef: { ...BASELINE.codechef, rating: 1300 } });
    // 250 + (100^2)/10 + 850 = 2100
    expect(cc.codechef.total).toBe(2100);
  });

  it('contest participation adds exactly 50', () => {
    const s = computeScore({ ...BASELINE, leetcode: { ...BASELINE.leetcode, contests: 18 } });
    expect(s.leetcode.total).toBe(2152);
  });

  it('ratingEffect is exact and hypothetical', () => {
    expect(ratingEffect('leetcode', 1373, 1570)).toBeCloseTo((270 ** 2 - 73 ** 2) / 10, 6);
    expect(ratingEffect('codechef', 1135, 1200)).toBe(0); // clamp: no effect until threshold
    expect(ratingEffect('codechef', 1135, 1300)).toBe(1000);
  });

  it('reference simulator scenario matches a hand computation', () => {
    const s = computeScore({
      ...BASELINE,
      leetcode: { problems: 190, rating: 1570, contests: 25 },
      codechef: { problems: 185, rating: 1400, contests: 25 },
      codeforces: { problems: 50, rating: 920, contests: 10 },
    });
    expect(s.leetcode.total).toBe(1900 + 7290 + 1250); // 10440
    expect(s.codechef.total).toBe(370 + 4000 + 1250); // 5620
    expect(s.codeforces.total).toBe(100 + 1440 + 500); // 2040
    expect(s.overall).toBe(126 + 7976 + 908 + 10440 + 5620 + 2040);
  });

  it('marginal exposes distance to the scoring threshold', () => {
    expect(marginal('codechef', 1135).ratingToThreshold).toBe(65);
    expect(marginal('leetcode', 1373).ratingToThreshold).toBe(0);
  });

  it('reachability reports how much of the gap the modelled platforms can cover', () => {
    const r = reachability(BASELINE, { leetcode: 1570, codechef: 1400, codeforces: 920 });
    expect(r.current).toBe(12604);
    expect(r.gained).toBeGreaterThan(0);
    expect(r.coveredShare).toBeLessThan(1);
    expect(r.fixedShareOfCurrent).toBeCloseTo((126 + 7976 + 908) / 12604, 6);
  });
});
