import { PLATFORM_RULES, ratingEffect } from './score.js';
import { dayEnd } from './time.js';
import { PLATFORM_LABEL, RATED_PLATFORMS, type Platform, type RatedPlatform } from './types.js';
import { selectProblems, solvedKey, type PoolProblem } from './objective.js';

/**
 * Pure, deterministic statements of consequence: what today's list is worth, in points, platform by platform,
 * and what that implies for the next milestone. Nothing here is estimated except where a field says "projection".
 */
export interface BriefItemIn {
  type: string; platform: Platform | null; required: boolean; quota: number; completedCount: number;
  completed: boolean; points: number; minutes: number; title: string;
}
export interface BriefStep {
  platform: Platform | null; label: string; kind: 'PROBLEMS' | 'CONTEST';
  remaining: number; points: number; minutes: number; scoreAfter: number; perHour: number;
}
export interface Brief {
  scoreNow: number; scoreAfter: number; gain: number; minutes: number; steps: BriefStep[];
  milestone: number | null; toMilestone: number | null; toMilestoneAfter: number | null;
  /** days to the milestone if this objective's certain points were earned every day; a statement of arithmetic, not a forecast */
  daysAtThisRate: number | null; dailyPoints: number;
  dayEndsAt: number;
  mostEfficient: { label: string; perHour: number } | null;
}

export function buildBrief(a: { items: BriefItemIn[]; scoreNow: number; milestone: number | null; now: number; tz: string; date: string; isRest: boolean }): Brief {
  const steps: BriefStep[] = [];
  let running = a.scoreNow;
  let dailyPoints = 0;
  for (const it of a.items) {
    const counts = it.required || it.type === 'CONTEST';
    if (!counts || a.isRest) continue;
    if (it.type === 'PROBLEM_QUOTA' && it.quota > 0) {
      const per = it.points / it.quota, perMin = it.minutes / it.quota;
      dailyPoints += it.points;
      const remaining = Math.max(0, it.quota - it.completedCount);
      if (remaining === 0) continue;
      const points = Math.round(remaining * per), minutes = Math.round(remaining * perMin);
      running += points;
      steps.push({ platform: it.platform, label: it.title, kind: 'PROBLEMS', remaining, points, minutes, scoreAfter: running, perHour: minutes > 0 ? Math.round((points / minutes) * 60 * 10) / 10 : 0 });
    } else if (it.type === 'CONTEST') {
      dailyPoints += it.points;
      if (it.completed) continue;
      running += it.points;
      steps.push({ platform: it.platform, label: it.title, kind: 'CONTEST', remaining: 1, points: it.points, minutes: it.minutes, scoreAfter: running, perHour: it.minutes > 0 ? Math.round((it.points / it.minutes) * 60 * 10) / 10 : 0 });
    }
  }
  const gain = running - a.scoreNow;
  const toMilestone = a.milestone === null ? null : Math.max(0, a.milestone - a.scoreNow);
  const best = [...steps].filter((s) => s.kind === 'PROBLEMS').sort((x, y) => y.perHour - x.perHour)[0];
  return {
    scoreNow: a.scoreNow, scoreAfter: running, gain, minutes: steps.reduce((t, s) => t + s.minutes, 0), steps,
    milestone: a.milestone, toMilestone, toMilestoneAfter: a.milestone === null ? null : Math.max(0, a.milestone - running),
    daysAtThisRate: a.milestone !== null && toMilestone! > 0 && dailyPoints > 0 ? Math.ceil(toMilestone! / dailyPoints) : null,
    dailyPoints, dayEndsAt: dayEnd(a.date, a.tz),
    mostEfficient: best ? { label: best.label, perHour: best.perHour } : null,
  };
}

// ---------- contests ----------

export interface ContestPlan {
  perContest: number;
  rating: number;
  /** projection only: the score effect of a further 25 rating points */
  ratingPlus25: number;
  attempt: number;
  warmup: { count: number; minutes: number; from: number; to: number; problems: PoolProblem[] };
  warmupBeginsAt: number;
}

const ATTEMPT: Record<RatedPlatform, (r: number) => number> = {
  leetcode: (r) => (r < 1600 ? 2 : 3),
  codechef: (r) => (r < 1400 ? 3 : 4),
  codeforces: (r) => (r < 1000 ? 2 : r < 1400 ? 3 : 4),
};

export function contestPlan(a: {
  platform: Platform; startAt: number; prepMinutes: number; rating: number | null; pool: PoolProblem[]; solved: Set<string>; date: string;
}): ContestPlan | null {
  if (!RATED_PLATFORMS.includes(a.platform as RatedPlatform)) return null;
  const p = a.platform as RatedPlatform;
  const rating = a.rating ?? 0;
  const count = 2;
  void solvedKey;
  return {
    perContest: PLATFORM_RULES[p].perContest,
    rating,
    ratingPlus25: Math.round(ratingEffect(p, rating, rating + 25)),
    attempt: ATTEMPT[p](rating),
    warmup: {
      count, minutes: count * 30, from: rating, to: rating + 200,
      problems: selectProblems(a.pool, a.solved, p, rating, count, a.date),
    },
    warmupBeginsAt: a.startAt - (a.prepMinutes + count * 30) * 60_000,
  };
}

export { PLATFORM_LABEL };
