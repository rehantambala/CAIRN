import type { RatedPlatform } from './types.js';

/**
 * Smart Interviews-style score engine. Pure and deterministic. No I/O, no LLM.
 *
 * Two rules on the rating term, both read from the leaderboard itself.
 *
 * 1. It is clamped at zero below the platform baseline (CodeChef 1,153 against 1,200 scores nothing from rating).
 * 2. It counts only from the third contest. In the 2 October 2026 export of 205 rows, every row with one or two
 *    contests scores its problems and contests alone, however high its rating (LeetCode 8 problems, rating 1,468,
 *    1 contest = 130, not 2,952), and every row with three or more includes the term. Codeforces follows the same
 *    published formula; no row in that export has a Codeforces rating above its baseline with fewer than three
 *    contests, so for Codeforces the rule is inferred, not observed.
 *
 * If either rule is ever disproved, change CLAMP_RATING_TERM_AT_ZERO or MIN_CONTESTS_FOR_RATING only.
 */
export const CLAMP_RATING_TERM_AT_ZERO = true;
export const MIN_CONTESTS_FOR_RATING = 3;

export const TARGET_MIN = 25_000;

export const PLATFORM_RULES: Record<
  RatedPlatform,
  { perProblem: number; ratingBase: number; perContest: number }
> = {
  leetcode: { perProblem: 10, ratingBase: 1300, perContest: 50 },
  codechef: { perProblem: 2, ratingBase: 1200, perContest: 50 },
  codeforces: { perProblem: 2, ratingBase: 800, perContest: 50 },
};

export interface RatedInputs { problems: number; rating: number; contests: number }

export interface ScoreInputs {
  leetcode: RatedInputs;
  codechef: RatedInputs;
  codeforces: RatedInputs;
  hackerrank: number;
  smartinterviews: number;
  interviewbit: number;
}

export interface RatedBreakdown {
  problemsPoints: number;
  ratingPoints: number;
  contestPoints: number;
  total: number;
}

/** `contests` defaults to a count that qualifies, so that a hypothetical rating change is judged as it would score once the term applies. */
export function ratingTerm(platform: RatedPlatform, rating: number, contests: number = MIN_CONTESTS_FOR_RATING): number {
  if (contests < MIN_CONTESTS_FOR_RATING) return 0;
  const base = PLATFORM_RULES[platform].ratingBase;
  const d = CLAMP_RATING_TERM_AT_ZERO ? Math.max(0, rating - base) : rating - base;
  return (d * d) / 10;
}

export function ratedBreakdown(platform: RatedPlatform, i: RatedInputs): RatedBreakdown {
  const r = PLATFORM_RULES[platform];
  const problemsPoints = i.problems * r.perProblem;
  const ratingPoints = ratingTerm(platform, i.rating, i.contests);
  const contestPoints = i.contests * r.perContest;
  return {
    problemsPoints,
    ratingPoints,
    contestPoints,
    total: Math.floor(problemsPoints + ratingPoints + contestPoints),
  };
}

export interface ScoreBreakdown {
  overall: number;
  leetcode: RatedBreakdown;
  codechef: RatedBreakdown;
  codeforces: RatedBreakdown;
  hackerrank: number;
  smartinterviews: number;
  interviewbit: number;
}

export function computeScore(i: ScoreInputs): ScoreBreakdown {
  const leetcode = ratedBreakdown('leetcode', i.leetcode);
  const codechef = ratedBreakdown('codechef', i.codechef);
  const codeforces = ratedBreakdown('codeforces', i.codeforces);
  const overall =
    i.hackerrank + i.smartinterviews + i.interviewbit +
    leetcode.total + codechef.total + codeforces.total;
  return {
    overall, leetcode, codechef, codeforces,
    hackerrank: i.hackerrank, smartinterviews: i.smartinterviews, interviewbit: i.interviewbit,
  };
}

export function remaining(score: number, target = TARGET_MIN): number {
  return Math.max(0, target - score);
}

/** DETERMINISTIC SCORE EFFECT of rating moving from `from` to `to` (hypothetical). */
export function ratingEffect(platform: RatedPlatform, from: number, to: number): number {
  return ratingTerm(platform, to) - ratingTerm(platform, from);
}

export interface Marginal {
  perProblem: number;
  perContest: number;
  /** points needed rating-wise until the clamp releases; 0 if already above */
  ratingToThreshold: number;
  /** contests still to attend before the rating term counts at all; 0 once there are three */
  contestsToRating: number;
  /** effect of +25 and +100 rating from the current value (hypothetical) */
  ratingPlus25: number;
  ratingPlus100: number;
}

export function marginal(platform: RatedPlatform, rating: number, contests: number = MIN_CONTESTS_FOR_RATING): Marginal {
  const r = PLATFORM_RULES[platform];
  return {
    perProblem: r.perProblem,
    perContest: r.perContest,
    ratingToThreshold: Math.max(0, r.ratingBase - rating),
    contestsToRating: Math.max(0, MIN_CONTESTS_FOR_RATING - contests),
    ratingPlus25: ratingEffect(platform, rating, rating + 25),
    ratingPlus100: ratingEffect(platform, rating, rating + 100),
  };
}

/**
 * Reachability: best score if LC/CC/CF ratings hit the given targets, with
 * problems and contests held as-is. Shows how much of the gap the modelled
 * platforms can cover, given SI/IB/HR stay fixed.
 */
/** A scenario only: each known rating 200 higher, or 100 past the point where rating starts to score. */
export function scenarioRatings(current: ScoreInputs, known: RatedPlatform[]): Partial<Record<RatedPlatform, number>> {
  const out: Partial<Record<RatedPlatform, number>> = {};
  for (const p of known) out[p] = Math.max(current[p].rating + 200, PLATFORM_RULES[p].ratingBase + 100);
  return out;
}

export function reachability(current: ScoreInputs, ratingTargets: Partial<Record<RatedPlatform, number>>, objective = TARGET_MIN) {
  const scenario: ScoreInputs = {
    ...current,
    leetcode: { ...current.leetcode, rating: Math.max(current.leetcode.rating, ratingTargets.leetcode ?? 0) },
    codechef: { ...current.codechef, rating: Math.max(current.codechef.rating, ratingTargets.codechef ?? 0) },
    codeforces: { ...current.codeforces, rating: Math.max(current.codeforces.rating, ratingTargets.codeforces ?? 0) },
  };
  const now = computeScore(current).overall;
  const projected = computeScore(scenario).overall;
  const gap = remaining(now, objective);
  return {
    current: now,
    projected,
    gained: projected - now,
    gap,
    coveredShare: gap === 0 ? 1 : Math.min(1, (projected - now) / gap),
    stillNeeded: remaining(projected, objective),
    targets: ratingTargets,
    fixedShareOfCurrent: now === 0 ? 0 :
      (current.smartinterviews + current.interviewbit + current.hackerrank) / now,
  };
}
