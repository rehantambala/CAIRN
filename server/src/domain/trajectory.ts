import { addDays, dayKey, daysBetween, DEFAULT_TZ } from './time.js';
import type { TrajectoryStatus } from './types.js';
import { TARGET_MIN } from './score.js';

export interface Snapshot { at: number; score: number }

export interface Trajectory {
  status: TrajectoryStatus;
  current: number;
  target: number;
  remaining: number;
  reached: boolean;
  gain1: number | null;
  gain7: number | null;
  gain14: number | null;
  gain30: number | null;
  /** trimmed mean of recent daily gains, points/day */
  velocity: number | null;
  requiredVelocity: number | null;
  daysToTarget: number | null;
  /** projected date at recent pace; never a guarantee */
  projectedDate: string | null;
  historyDays: number;
  note: string;
}

export const MIN_HISTORY_DAYS = 7;

/** Carry the last known score across each local day from first snapshot to today. */
export function dailySeries(snaps: Snapshot[], today: string, tz = DEFAULT_TZ): { day: string; score: number }[] {
  if (snaps.length === 0) return [];
  const sorted = [...snaps].sort((a, b) => a.at - b.at);
  const byDay = new Map<string, number>();
  for (const s of sorted) byDay.set(dayKey(s.at, tz), s.score);
  const first = dayKey(sorted[0].at, tz);
  const out: { day: string; score: number }[] = [];
  let last = sorted[0].score;
  for (let d = first, guard = 0; daysBetween(d, today) >= 0 && guard < 4000; d = addDays(d, 1), guard++) {
    if (byDay.has(d)) last = byDay.get(d)!;
    out.push({ day: d, score: last });
  }
  return out;
}

function trimmedMean(xs: number[]): number {
  if (xs.length === 0) return 0;
  if (xs.length < 4) return xs.reduce((a, b) => a + b, 0) / xs.length;
  const s = [...xs].sort((a, b) => a - b);
  const t = s.slice(1, -1); // drop the single largest and smallest so one jump cannot drive the pace
  return t.reduce((a, b) => a + b, 0) / t.length;
}

export function computeTrajectory(opts: {
  snapshots: Snapshot[];
  now: number;
  target?: number;
  targetDate?: string | null;
  tz?: string;
}): Trajectory {
  const tz = opts.tz ?? DEFAULT_TZ;
  const target = opts.target ?? TARGET_MIN;
  const today = dayKey(opts.now, tz);
  const series = dailySeries(opts.snapshots.filter((s) => s.at <= opts.now), today, tz);
  const current = series.length ? series[series.length - 1].score : 0;
  const remainingPts = Math.max(0, target - current);
  const historyDays = series.length;

  const gainOver = (n: number): number | null =>
    series.length > n ? current - series[series.length - 1 - n].score : null;

  const gain1 = gainOver(1), gain7 = gainOver(7), gain14 = gainOver(14), gain30 = gainOver(30);

  const daysToTarget = opts.targetDate ? Math.max(0, daysBetween(today, opts.targetDate)) : null;
  const requiredVelocity =
    daysToTarget !== null && daysToTarget > 0 ? remainingPts / daysToTarget : null;

  const base = {
    current, target, remaining: remainingPts, reached: current >= target,
    gain1, gain7, gain14, gain30, requiredVelocity, daysToTarget, historyDays,
  };

  if (current >= target) {
    return { ...base, status: 'AHEAD', velocity: null, projectedDate: null, note: 'OBJECTIVE COMPLETED' };
  }

  if (historyDays < MIN_HISTORY_DAYS) {
    return {
      ...base, status: 'INSUFFICIENT DATA', velocity: null, projectedDate: null,
      note: `${historyDays} of ${MIN_HISTORY_DAYS} days of history needed`,
    };
  }

  const window = series.slice(-15); // up to 14 daily deltas
  const deltas: number[] = [];
  for (let i = 1; i < window.length; i++) deltas.push(window[i].score - window[i - 1].score);
  const velocity = trimmedMean(deltas);
  const projectedDate =
    velocity > 0 ? addDays(today, Math.ceil(remainingPts / velocity)) : null;

  if (requiredVelocity === null) {
    return {
      ...base, status: 'INSUFFICIENT DATA', velocity, projectedDate,
      note: 'Set a target date to measure pace',
    };
  }

  const ratio = requiredVelocity === 0 ? Infinity : velocity / requiredVelocity;
  const status: TrajectoryStatus = ratio >= 1.1 ? 'AHEAD' : ratio >= 0.9 ? 'ON PACE' : 'PACE DEFICIT';
  return {
    ...base, status, velocity, projectedDate,
    note: `${velocity.toFixed(1)} pts/day recent, ${requiredVelocity.toFixed(1)} pts/day required`,
  };
}

/** Milestones used by the 25K visual; the first unreached one is "next". */
export const MILESTONES = [14_000, 16_000, 18_000, 20_000, 22_500, 25_000] as const;
