import type { RatedPlatform } from './types.js';

/**
 * Smart Interviews-style score engine. Pure and deterministic. No I/O, no LLM.
 *
 * The rating term is clamped at zero below the platform baseline. The user's
 * published numbers only reconcile with the clamp (CodeChef 125 problems,
 * rating 1135, 17 contests = 1,100, not 1,522). If the clamp is ever disproved,
 * change CLAMP_RATING_TERM_AT_ZERO only.
 */
export const CLAMP_RATING_TERM_AT_ZERO = true;

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

export function ratingTerm(platform: RatedPlatform, rating: number): number {
  const base = PLATFORM_RULES[platform].ratingBase;
  const d = CLAMP_RATING_TERM_AT_ZERO ? Math.max(0, rating - base) : rating - base;
  return (d * d) / 10;
}

export function ratedBreakdown(platform: RatedPlatform, i: RatedInputs): RatedBreakdown {
  const r = PLATFORM_RULES[platform];
  const problemsPoints = i.problems * r.perProblem;
  const ratingPoints = ratingTerm(platform, i.rating);
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
  /** effect of +25 and +100 rating from the current value (hypothetical) */
  ratingPlus25: number;
  ratingPlus100: number;
}

export function marginal(platform: RatedPlatform, rating: number): Marginal {
  const r = PLATFORM_RULES[platform];
  return {
    perProblem: r.perProblem,
    perContest: r.perContest,
    ratingToThreshold: Math.max(0, r.ratingBase - rating),
    ratingPlus25: ratingEffect(platform, rating, rating + 25),
    ratingPlus100: ratingEffect(platform, rating, rating + 100),
  };
}

/**
 * Reachability: best score if LC/CC/CF ratings hit the given targets, with
 * problems and contests held as-is. Shows how much of the gap the modelled
 * platforms can cover, given SI/IB/HR stay fixed.
 */
export function reachability(current: ScoreInputs, ratingTargets: Record<RatedPlatform, number>) {
  const scenario: ScoreInputs = {
    ...current,
    leetcode: { ...current.leetcode, rating: Math.max(current.leetcode.rating, ratingTargets.leetcode) },
    codechef: { ...current.codechef, rating: Math.max(current.codechef.rating, ratingTargets.codechef) },
    codeforces: { ...current.codeforces, rating: Math.max(current.codeforces.rating, ratingTargets.codeforces) },
  };
  const now = computeScore(current).overall;
  const projected = computeScore(scenario).overall;
  const gap = remaining(now);
  return {
    current: now,
    projected,
    gained: projected - now,
    gap,
    coveredShare: gap === 0 ? 1 : Math.min(1, (projected - now) / gap),
    stillNeeded: remaining(projected),
    fixedShareOfCurrent: now === 0 ? 0 :
      (current.smartinterviews + current.interviewbit + current.hackerrank) / now,
  };
}
