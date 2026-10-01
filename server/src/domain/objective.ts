import { computeScore, marginal, PLATFORM_RULES, ratingEffect, type ScoreInputs } from './score.js';
import { dayEnd, dayStart, formatCountdown, hourMinute } from './time.js';
import type { Trajectory } from './trajectory.js';
import { PLATFORM_LABEL, RATED_PLATFORMS, type Platform, type RatedPlatform } from './types.js';

export interface PoolProblem {
  platform: Platform;
  externalId: string;
  title: string;
  url: string;
  difficulty: string | null;
  topic: string | null;
}

export interface ContestCandidate {
  id: string;
  platform: Platform;
  title: string;
  startAt: number;
  endAt: number;
  rated: boolean;
  committed: boolean;
  registrationUrl: string | null;
  contestUrl: string | null;
}

export interface ObjectiveState {
  now: number;
  tz: string;
  date: string; // local YYYY-MM-DD
  scoreInputs: ScoreInputs;
  trajectory: Trajectory;
  executionRate: number | null; // 0..100 over the last 28 closed days
  consecutiveComplete: number;
  contests: ContestCandidate[]; // not finished
  solved: Set<string>; // `${platform}:${externalId}`
  pool: PoolProblem[];
  baseMinutes?: number;
}

export type ItemType = 'PROBLEM_QUOTA' | 'CONTEST' | 'CONTEST_PREP' | 'REST';

export interface ObjectiveItem {
  type: ItemType;
  platform: Platform | null;
  contestId: string | null;
  title: string;
  reason: string;
  required: boolean;
  quota: number;
  minutes: number;
  /** deterministic score effect if completed, in points */
  points: number;
  suggestions: PoolProblem[];
  /** real platform practice page; used when the pool has no unsolved problem to suggest */
  practiceUrl: string | null;
  guidance: string | null;
}

export interface Objective {
  date: string;
  isRest: boolean;
  items: ObjectiveItem[];
  targetScoreDelta: number;
  rationale: string[];
}

const MINUTES_PER_PROBLEM: Record<RatedPlatform, number> = { leetcode: 30, codechef: 30, codeforces: 40 };
const BASE_WEIGHT: Record<RatedPlatform, number> = { leetcode: 0.5, codechef: 0.3, codeforces: 0.2 };
const DIFF_OFFSET: Record<RatedPlatform, number> = { leetcode: 100, codechef: 50, codeforces: 100 };
const PRACTICE_URL: Record<RatedPlatform, string> = {
  leetcode: 'https://leetcode.com/problemset/',
  codechef: 'https://www.codechef.com/practice',
  codeforces: 'https://codeforces.com/problemset',
};
export function suggestionGuidance(found: number, quota: number, rating: number): string | null {
  if (found >= quota) return null;
  return `The pool holds ${found} unsolved suggestion${found === 1 ? '' : 's'}. Select unsolved problems rated about ${rating}–${rating + 200}.`;
}
const WORD_DIFFICULTY: Record<string, number> = { easy: 1100, medium: 1500, hard: 1900 };

export const solvedKey = (platform: Platform, id: string) => `${platform}:${id}`;

export function difficultyValue(d: string | null): number | null {
  if (!d) return null;
  const n = Number(d);
  if (Number.isFinite(n)) return n;
  return WORD_DIFFICULTY[d.toLowerCase()] ?? null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic for a given (date, pool, solved, rating). Never returns a solved problem. */
export function selectProblems(
  pool: PoolProblem[], solved: Set<string>, platform: RatedPlatform,
  rating: number, n: number, date: string,
): PoolProblem[] {
  if (n <= 0) return [];
  const target = rating + DIFF_OFFSET[platform];
  return pool
    .filter((p) => p.platform === platform && !solved.has(solvedKey(p.platform, p.externalId)))
    .map((p) => {
      const v = difficultyValue(p.difficulty);
      return { p, dist: v === null ? 400 : Math.abs(v - target), tie: hash(`${date}|${p.externalId}`) };
    })
    .sort((a, b) => a.dist - b.dist || a.tie - b.tie)
    .slice(0, n)
    .map((x) => x.p);
}

function availablePool(state: ObjectiveState, platform: RatedPlatform): number {
  return state.pool.filter(
    (p) => p.platform === platform && !state.solved.has(solvedKey(p.platform, p.externalId)),
  ).length;
}

function todaysContests(state: ObjectiveState): ContestCandidate[] {
  const s = dayStart(state.date, state.tz), e = dayEnd(state.date, state.tz);
  return state.contests.filter(
    (c) => c.rated && c.startAt >= s && c.startAt < e && c.endAt > state.now,
  );
}

export function generateObjective(state: ObjectiveState): Objective {
  const rationale: string[] = [];
  const items: ObjectiveItem[] = [];
  const score = computeScore(state.scoreInputs);
  const contests = todaysContests(state);
  const committedToday = contests.filter((c) => c.committed);

  // REST is engine-chosen: a long unbroken run of complete days, with no committed contest today.
  if (state.consecutiveComplete >= 6 && committedToday.length === 0) {
    return {
      date: state.date, isRest: true, targetScoreDelta: 0,
      rationale: [`${state.consecutiveComplete} consecutive complete days. A rest day is scheduled; it does not interrupt the record.`],
      items: [{
        type: 'REST', platform: null, contestId: null, title: 'Rest',
        reason: `${state.consecutiveComplete} consecutive days are complete. Recovery is scheduled because sustained output depends on it, and it does not interrupt your record.`,
        required: false, quota: 0, minutes: 0, points: 0, suggestions: [], practiceUrl: null, guidance: null,
      }],
    };
  }

  // Time budget, adapted to demonstrated consistency and pace.
  let budget = state.baseMinutes ?? 120;
  if (state.executionRate !== null) {
    if (state.executionRate < 50) { budget = Math.round(budget * 0.7); rationale.push(`Execution rate is ${state.executionRate} per cent. The load has been reduced so that consistency can be rebuilt.`); }
    else if (state.executionRate >= 85) budget = Math.round(budget * 1.15);
  }
  if (state.trajectory.status === 'PACE DEFICIT' && (state.executionRate ?? 0) >= 70) {
    budget += 20;
    rationale.push('The pace is below the required rate, but consistency is strong. Volume has been increased.');
  }

  // Contests today come first: they carry the +50 and the only route to rating movement.
  for (const c of contests) {
    const dur = Math.round((c.endAt - c.startAt) / 60_000);
    const p = c.platform as RatedPlatform;
    const perContest = RATED_PLATFORMS.includes(p) ? PLATFORM_RULES[p].perContest : 0;
    if (c.committed) {
      items.push({
        type: 'CONTEST_PREP', platform: c.platform, contestId: c.id,
        title: 'Contest preparation',
        reason: `Preparation for ${c.title} begins at ${hourMinute(c.startAt - 30 * 60_000, state.tz)}, so that the rated attempt starts from a prepared position.`,
        required: false, quota: 1, minutes: 30, points: 0, suggestions: [], practiceUrl: null, guidance: null,
      });
      budget -= 30 + Math.min(dur, 120);
    }
    items.push({
      type: 'CONTEST', platform: c.platform, contestId: c.id,
      title: `${PLATFORM_LABEL[c.platform]} ${c.title}`,
      reason: c.committed
        ? `You are committed. Participation adds ${perContest} points with certainty; the rating outcome is not certain.`
        : `A rated contest begins at ${hourMinute(c.startAt, state.tz)}. Participation adds ${perContest} points with certainty. Committing makes it a required item and enables reminders.`,
      required: c.committed, quota: 1, minutes: dur, points: perContest, suggestions: [],
      practiceUrl: c.contestUrl, guidance: null,
    });
  }
  budget = Math.max(45, budget);

  // Platform weights from marginal structure, not from "solve more".
  const weights = {} as Record<RatedPlatform, number>;
  for (const p of RATED_PLATFORMS) {
    let w = BASE_WEIGHT[p];
    const below = PLATFORM_RULES[p].ratingBase - state.scoreInputs[p].rating;
    if (below > 0) w += 0.1;
    if (contests.some((c) => c.platform === p) || state.contests.some((c) => c.platform === p && c.rated && c.startAt - state.now < 48 * 3_600_000 && c.startAt > state.now)) w += 0.1;
    weights[p] = w;
  }
  const wSum = RATED_PLATFORMS.reduce((a, p) => a + weights[p], 0);

  const quotas = {} as Record<RatedPlatform, number>;
  for (const p of RATED_PLATFORMS) {
    if (wSum === 0 || weights[p] === 0) { quotas[p] = 0; continue; }
    const share = weights[p] / wSum;
    let q = Math.round((budget * share) / MINUTES_PER_PROBLEM[p]);
    if (q === 0 && share >= 0.2 && budget >= MINUTES_PER_PROBLEM[p] * 2) q = 1;
    quotas[p] = Math.min(q, 6);
  }
  if (RATED_PLATFORMS.every((p) => quotas[p] === 0) && contests.length === 0 && wSum > 0) {
    const best = [...RATED_PLATFORMS].sort((a, b) => weights[b] - weights[a])[0];
    quotas[best] = 2;
  }

  const order = [...RATED_PLATFORMS].sort((a, b) => PLATFORM_RULES[b].perProblem - PLATFORM_RULES[a].perProblem || weights[b] - weights[a]);
  for (const p of order) {
    const q = quotas[p];
    if (q <= 0) continue;
    const m = marginal(p, state.scoreInputs[p].rating);
    const reasons = [`Each accepted problem adds ${m.perProblem} points with certainty.`];
    if (m.ratingToThreshold > 0) {
      reasons.push(`Your rating of ${state.scoreInputs[p].rating} is ${m.ratingToThreshold} below the ${PLATFORM_RULES[p].ratingBase} at which rating gains begin to score, so problems are the dependable source of points here until then.`);
    } else {
      reasons.push(`A rating of ${state.scoreInputs[p].rating + 25} would add ${Math.round(ratingEffect(p, state.scoreInputs[p].rating, state.scoreInputs[p].rating + 25))} points. That is a projection, not a certainty.`);
    }
    const suggestions = selectProblems(state.pool, state.solved, p, state.scoreInputs[p].rating, q + 2, state.date);
    const lo = state.scoreInputs[p].rating;
    items.push({
      type: 'PROBLEM_QUOTA', platform: p, contestId: null,
      title: `${PLATFORM_LABEL[p]}`,
      reason: reasons.join(' '),
      required: true, quota: q, minutes: q * MINUTES_PER_PROBLEM[p], points: q * m.perProblem,
      suggestions,
      practiceUrl: PRACTICE_URL[p],
      guidance: suggestionGuidance(suggestions.length, q, lo),
    });
  }

  const targetScoreDelta = items.reduce((a, i) => a + (i.required || i.type === 'CONTEST' ? i.points : 0), 0);

  const t = state.trajectory;
  if (t.requiredVelocity !== null) {
    const volume = items.filter((i) => i.type === 'PROBLEM_QUOTA').reduce((a, i) => a + i.points, 0);
    rationale.push(
      `The required pace is ${t.requiredVelocity.toFixed(0)} points a day. Today's problems add ${volume} with certainty; the remainder depends on rating, which is not certain.`,
    );
  }
  if (score.overall >= 25_000) rationale.push('The target of 25,000+ has been reached. Tracking continues beyond it.');

  if (items.length === 0) {
    rationale.push('The pool holds no unsolved problems and no rated contest is scheduled today.');
  }
  return { date: state.date, isRest: false, items, targetScoreDelta, rationale };
}

export interface NextAction {
  kind: 'CONTEST' | 'ITEM' | 'COMMIT' | 'COMPLETE' | 'EMPTY';
  label: string;
  title: string;
  detail: string;
  reason: string;
  target: string | null;
  href: string;
  startsInMs: number | null;
  contestId: string | null;
}

export interface ItemProgress { item: ObjectiveItem; done: number; completed: boolean }

export function pickNext(
  progress: ItemProgress[], contests: ContestCandidate[], now: number, tz: string,
): NextAction {
  // 1. A contest that is live or begins within 3 hours outranks everything else.
  const soon = contests
    .filter((c) => c.rated && c.endAt > now && c.startAt - now < 3 * 3_600_000)
    .sort((a, b) => a.startAt - b.startAt)[0];
  if (soon) {
    const live = now >= soon.startAt;
    const p = soon.platform as RatedPlatform;
    const m = RATED_PLATFORMS.includes(p) ? marginal(p, 0) : null;
    return {
      kind: 'CONTEST', label: 'NEXT',
      title: `${PLATFORM_LABEL[soon.platform]} ${soon.title}`,
      detail: live ? 'Rated contest · in progress' : `Rated contest · begins in ${formatCountdown(soon.startAt - now)}, at ${hourMinute(soon.startAt, tz)}`,
      reason: `Participation adds ${m?.perContest ?? 50} points with certainty. It is also the only route to rating movement, which has the largest effect on the score.`,
      target: soon.committed ? 'Enter prepared.' : 'Commit, so that reminders are scheduled.',
      href: `/contests?focus=${encodeURIComponent(soon.id)}`,
      startsInMs: live ? 0 : soon.startAt - now, contestId: soon.id,
    };
  }

  // 2. The first incomplete required item, in objective order.
  const open = progress.find((x) => x.item.required && !x.completed);
  if (open) {
    const it = open.item;
    return {
      kind: 'ITEM', label: 'NEXT',
      title: it.title,
      detail: it.type === 'PROBLEM_QUOTA'
        ? `${it.quota - open.done} of ${it.quota} problems remain`
        : it.title,
      reason: it.reason,
      target: it.suggestions[0] ? `Begin with ${it.suggestions[0].title}` : null,
      href: '/today', startsInMs: null, contestId: it.contestId,
    };
  }

  // 3. Day complete: point at the next rated opportunity.
  const upcoming = contests.filter((c) => c.rated && c.startAt > now).sort((a, b) => a.startAt - b.startAt)[0];
  if (progress.some((x) => x.item.required) ) {
    if (upcoming) {
      return {
        kind: 'COMMIT', label: 'NEXT',
        title: `${PLATFORM_LABEL[upcoming.platform]} ${upcoming.title}`,
        detail: `Today's objective is complete · the next rated contest begins in ${formatCountdown(upcoming.startAt - now)}`,
        reason: 'Committing schedules preparation and reminders.',
        target: null, href: `/contests?focus=${encodeURIComponent(upcoming.id)}`,
        startsInMs: upcoming.startAt - now, contestId: upcoming.id,
      };
    }
    return {
      kind: 'COMPLETE', label: 'NEXT', title: 'Objective complete',
      detail: 'Execution is recorded. Tomorrow\'s objective is generated at midnight.',
      reason: 'Every required item is complete.', target: null, href: '/calendar',
      startsInMs: null, contestId: null,
    };
  }

  if (upcoming) {
    return {
      kind: 'COMMIT', label: 'NEXT',
      title: `${PLATFORM_LABEL[upcoming.platform]} ${upcoming.title}`,
      detail: `Rest day · the next rated contest begins in ${formatCountdown(upcoming.startAt - now)}`,
      reason: 'No work is required today. Committing to the next rated contest schedules preparation and reminders.',
      target: null, href: `/contests?focus=${encodeURIComponent(upcoming.id)}`,
      startsInMs: upcoming.startAt - now, contestId: upcoming.id,
    };
  }
  return {
    kind: 'EMPTY', label: 'NEXT', title: 'Nothing scheduled',
    detail: 'No work is required and no rated contest is upcoming.',
    reason: 'Synchronise a platform or add problems to the pool.', target: null, href: '/settings',
    startsInMs: null, contestId: null,
  };
}
