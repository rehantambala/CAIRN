/**
 * Product language. Formal British English; every sentence states what is true of the data,
 * when it applies, and why it matters. Nothing here invents urgency or flatters.
 * Lines are deterministic for a given state, so the page never changes wording on re-render.
 */
import { countdown, fmt, shortK } from './format';

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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** One statement at the head of the page: the present situation, and what follows from it. */
export function dayLine(c: DayCtx): string {
  const left = c.total - c.done;
  if (c.total === 0 && !c.isRest) {
    return 'No problem work is planned today. Daily work is drawn from LeetCode, CodeChef and Codeforces; connect one of them in Preferences.';
  }
  switch (dayMood(c)) {
    case 'rest':
      return 'Today is a scheduled rest day. Recovery is planned because sustained output depends on it, and it does not interrupt your record.';
    case 'done':
      return c.streak >= 2
        ? `Today’s required work is complete and verified, which makes ${c.streak} consecutive days. The record is what moves the score.`
        : 'Today’s required work is complete and verified. The score has been updated to reflect it.';
    case 'manual':
      return 'Today’s required work is complete, but it was recorded by you. Synchronise or import the platform data to verify it.';
    case 'contest':
      return `A contest to which you have committed begins in ${countdown(c.contestSoonMs ?? 0)}. A rated attempt is presently more consequential than further practice.`;
    case 'started':
      return `${c.done} of ${c.total} required ${plural(c.total, 'item is', 'items are')} complete. ${left} ${plural(left, 'remains', 'remain')} before the day closes at midnight.`;
    case 'late':
      return c.streak > 0
        ? `${left} required ${plural(left, 'item remains', 'items remain')} today, and the day closes at midnight. Completing ${plural(left, 'it', 'them')} preserves a record of ${c.streak} consecutive ${plural(c.streak, 'day', 'days')}.`
        : `${left} required ${plural(left, 'item remains', 'items remain')} today, and the day closes at midnight. Completing ${plural(left, 'it', 'them')} begins your record.`;
    default:
      return 'Today’s objective is set out below. The first item is the place to begin; the day closes at midnight.';
  }
}

export function streakLine(n: number): string {
  if (n <= 0) return 'No consecutive verified days are recorded. Today would begin the record.';
  if (n === 1) return 'One verified day is recorded. A second would establish a pattern.';
  return `${n} consecutive verified days.`;
}

export function streakHead(n: number): string {
  return n <= 0 ? 'No record yet' : n === 1 ? 'One verified day' : `${n} verified days`;
}

/** Near milestone and far target, stated as distances. */
export function gradient(current: number, next: number | null, target: number) {
  const pct = Math.min(100, Math.floor((current / target) * 100));
  return {
    pct,
    near: next ? `${fmt(next - current)} points remain to the ${shortK(next)} milestone.` : `The target of ${fmt(target)}+ has been passed.`,
    far: next ? `${pct} per cent of the target of ${fmt(target)}+ is complete.` : 'Tracking continues beyond the target.',
  };
}

export const STATUS_WORD: Record<string, string> = {
  AHEAD: 'Ahead of the required pace',
  'ON PACE': 'On the required pace',
  'PACE DEFICIT': 'Below the required pace',
  'INSUFFICIENT DATA': 'Baseline in progress',
};

export function statusLine(status: string, historyDays: number): string {
  if (status === 'INSUFFICIENT DATA') return `${Math.min(historyDays, 7)} of 7 days are recorded. A pace can be stated reliably only after seven.`;
  if (status === 'AHEAD') return 'Your recent rate of gain exceeds the rate that the target date requires.';
  if (status === 'ON PACE') return 'Your recent rate of gain matches the rate that the target date requires.';
  return 'Your recent rate of gain is below the rate that the target date requires. The shortfall is recovered only by raising the daily rate.';
}

export function greetingWord(hour: number): string {
  return hour < 5 ? 'Early hours' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function doneHeadline(delta: number, verified: boolean): string {
  if (!verified) return 'Recorded';
  return delta > 0 ? `Complete, ${fmt(delta)} points` : 'Complete';
}
