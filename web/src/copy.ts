/**
 * Motivation copy. Every line is chosen by a rule tied to a documented behavioural principle
 * (see DESIGN.md) and is deterministic for a given day, so the page never re-rolls on re-render.
 * Nothing here invents urgency, guilt or facts: every line is true of the data that triggers it.
 */
import { fmt, shortK } from './format';

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
export function pick<T>(seed: string, arr: T[]): T { return arr[hash(seed) % arr.length]; }

export type Mood = 'fresh' | 'late' | 'started' | 'done' | 'manual' | 'rest' | 'contest';

export interface DayCtx {
  date: string; hour: number; done: number; total: number; streak: number; isRest: boolean;
  allVerified: boolean; contestSoonMs: number | null;
}

export function dayMood(c: DayCtx): Mood {
  if (c.isRest) return 'rest';
  if (c.total > 0 && c.done >= c.total) return c.allVerified ? 'done' : 'manual';
  if (c.contestSoonMs !== null && c.contestSoonMs < 6 * 3_600_000) return 'contest';
  if (c.done > 0) return 'started';
  return c.hour >= 18 ? 'late' : 'fresh';
}

/** One sentence at the top of the page. Specific, small, and framed as identity or momentum. */
export function dayLine(c: DayCtx): string {
  const s = `${c.date}:${dayMood(c)}`;
  switch (dayMood(c)) {
    case 'rest':
      return pick(s, ['Recovery day. Rest is part of the plan, not a break from it.', 'Nothing required today. Recovery is how the next push lands.']);
    case 'done':
      return c.streak >= 2
        ? pick(s, [`${c.streak} verified days in a row. This is what showing up looks like.`, `Day ${c.streak}. You keep doing what you said you would.`])
        : pick(s, ['Done, and verified. That is the work that compounds.', 'Today is banked. The score already knows.']);
    case 'manual':
      return 'Done, marked by you. Sync or import to turn it into a verified day.';
    case 'contest':
      return 'A rated contest is close. Enter prepared and calm.';
    case 'started':
      return pick(s, [`${c.done} of ${c.total} done. Finishing is easier than starting was.`, `You have started, which was the hard part. ${c.total - c.done} to go.`]);
    case 'late':
      return c.streak > 0
        ? pick(s, [`Tonight is still open. One problem keeps the ${c.streak}-day chain.`, `The window closes at midnight. One problem is enough to keep the chain.`])
        : pick(s, ['Tonight is still open. One problem beats zero.', 'There is time. One problem is a real start.']);
    default:
      return pick(s, ['Start small. One problem is the whole job right now.', 'Open the first problem. Momentum does the rest.', 'Two minutes of effort gets this moving.']);
  }
}

export function streakLine(n: number): string {
  if (n <= 0) return 'Your streak starts with today.';
  if (n === 1) return '1 verified day. Make it 2.';
  return `${n} verified days in a row.`;
}

/** Goal-gradient: show the near milestone, not only the far target. */
export function gradient(current: number, next: number | null, target: number) {
  const pct = Math.min(100, Math.floor((current / target) * 100));
  return {
    pct,
    near: next ? `${fmt(next - current)} to the ${shortK(next)} mark.` : `Past ${fmt(target)}. Tracking continues.`,
    far: `${pct}% of the way to ${fmt(target)}+.`,
  };
}

export const STATUS_WORD: Record<string, string> = {
  AHEAD: 'Ahead of pace',
  'ON PACE': 'On pace',
  'PACE DEFICIT': 'Behind pace',
  'INSUFFICIENT DATA': 'Building your baseline',
};

export function statusLine(status: string, historyDays: number): string {
  if (status === 'INSUFFICIENT DATA') return `${Math.min(historyDays, 7)} of 7 days recorded. Pace becomes meaningful after a week.`;
  if (status === 'AHEAD') return 'Your recent pace beats what the target date needs.';
  if (status === 'ON PACE') return 'Your recent pace matches what the target date needs.';
  return 'Your recent pace is below what the target date needs. Small daily gains close this.';
}

export function greetingWord(hour: number): string {
  return hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function doneHeadline(delta: number, verified: boolean): string {
  if (!verified) return 'Marked done.';
  return delta > 0 ? `Done. +${fmt(delta)} today.` : 'Done for today.';
}
