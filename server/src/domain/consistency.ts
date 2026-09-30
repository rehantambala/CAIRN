import type { DayState } from './types.js';

export interface DayRecord { date: string; state: DayState; requiredTotal: number; requiredDone: number }

export interface ContestRecord { committed: boolean; attended: boolean; startHourLocal: number; startMinuteLocal: number }

export interface Consistency {
  executionRate: number | null;
  weeklyCompletion: number | null;
  contestAttendance: number | null;
  plannedSessions: number;
  completedSessions: number;
  consecutiveComplete: number;
  bottleneck: { window: string; misses: number } | null;
  recommendation: string | null;
}

const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 100));

/** days sorted ascending by date; only days before today count as closed. */
export function computeConsistency(
  days: DayRecord[], contests: ContestRecord[], today: string,
): Consistency {
  const closed = days.filter((d) => d.date < today && d.state !== 'REST');
  const last28 = closed.slice(-28);
  const last7 = closed.slice(-7);

  const done = (xs: DayRecord[]) => xs.filter((d) => d.state === 'COMPLETE').length;
  const executionRate = pct(done(last28), last28.length);
  const weeklyCompletion = pct(done(last7), last7.length);

  const committed = contests.filter((c) => c.committed);
  const contestAttendance = pct(committed.filter((c) => c.attended).length, committed.length);

  const plannedSessions = days.reduce((a, d) => a + d.requiredTotal, 0);
  const completedSessions = days.reduce((a, d) => a + d.requiredDone, 0);

  let consecutiveComplete = 0;
  const past = days.filter((d) => d.date < today && d.state !== 'REST');
  for (let i = past.length - 1; i >= 0 && past[i].state === 'COMPLETE'; i--) consecutiveComplete++;

  // Bottleneck: committed contests that were not attended, clustered into a 90-minute window.
  const missed = committed.filter((c) => !c.attended);
  let bottleneck: Consistency['bottleneck'] = null;
  if (missed.length >= 3) {
    const buckets = new Map<number, number>();
    for (const c of missed) {
      const minutes = c.startHourLocal * 60 + c.startMinuteLocal;
      const b = Math.floor(minutes / 90);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const [bucket, count] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count >= 3) {
      const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      bottleneck = { window: `${fmt(bucket * 90)}–${fmt(bucket * 90 + 90)}`, misses: count };
    }
  }

  return {
    executionRate, weeklyCompletion, contestAttendance, plannedSessions, completedSessions,
    consecutiveComplete, bottleneck,
    recommendation: bottleneck ? 'Pre-commit the preparation block.' : null,
  };
}
