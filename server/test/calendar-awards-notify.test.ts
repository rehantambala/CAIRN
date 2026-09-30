import { describe, expect, it } from 'vitest';
import { dayState } from '../src/domain/calendar.js';
import { eligibleAwards, newAwards } from '../src/domain/awards.js';
import { buildMessage, isStillRelevant, planContestReminders } from '../src/domain/notifications.js';
import { addDays, dayEnd, dayKey, dayStart } from '../src/domain/time.js';
import { computeConsistency } from '../src/domain/consistency.js';

const item = (completed: boolean, verification: 'VERIFIED' | 'MANUAL' | 'PENDING' = 'VERIFIED', required = true) => ({ required, completed, verification });

describe('calendar', () => {
  it('COMPLETE only when every required item is done', () => {
    expect(dayState({ isRest: false, isToday: true, items: [item(true), item(true)] }).state).toBe('COMPLETE');
    expect(dayState({ isRest: false, isToday: true, items: [item(true), item(false)] }).state).toBe('ACTIVE');
  });
  it('past days: MISSED with nothing done, PARTIAL with some', () => {
    expect(dayState({ isRest: false, isToday: false, items: [item(false), item(false)] }).state).toBe('MISSED');
    expect(dayState({ isRest: false, isToday: false, items: [item(true), item(false)] }).state).toBe('PARTIAL');
  });
  it('REST days are REST', () => {
    expect(dayState({ isRest: true, isToday: false, items: [] }).state).toBe('REST');
  });
  it('manual completion is complete but not verified', () => {
    const r = dayState({ isRest: false, isToday: false, items: [item(true, 'MANUAL')] });
    expect(r.state).toBe('COMPLETE');
    expect(r.verified).toBe(false);
  });
  it('optional items never block completion', () => {
    expect(dayState({ isRest: false, isToday: true, items: [item(true), item(false, 'PENDING', false)] }).state).toBe('COMPLETE');
  });
});

describe('awards', () => {
  const m = { verifiedDays: 8, ratedContests: 10, problems: { leetcode: 100, codechef: 99, codeforces: 5 }, ratings: { leetcode: 1373, codechef: 1135, codeforces: 835 }, overall: 12604 };
  it('evaluates eligibility from measured values', () => {
    expect(eligibleAwards(m).sort()).toEqual(['contests_10', 'days_7', 'lc_100']);
  });
  it('is idempotent: held awards are not re-awarded', () => {
    expect(newAwards(m, ['days_7', 'contests_10', 'lc_100'])).toEqual([]);
  });
});

describe('notifications', () => {
  const START = dayStart('2026-10-04') + 20 * 3_600_000;
  const c = { id: 'codechef:S1', platform: 'codechef' as const, title: 'Starters', startAt: START, endAt: START + 2 * 3_600_000 };
  it('plans only 24h when uncommitted', () => {
    const p = planContestReminders(c, false, START - 3 * 86_400_000);
    expect(p.map((x) => x.type)).toEqual(['CONTEST_24H']);
  });
  it('plans the full set when committed', () => {
    const p = planContestReminders(c, true, START - 3 * 86_400_000);
    expect(p.map((x) => x.type)).toEqual(['CONTEST_24H', 'CONTEST_1H', 'CONTEST_10M', 'CONTEST_CLOSED']);
  });
  it('tolerates a delayed job: missed slots are dropped only when their moment has passed', () => {
    const late = planContestReminders(c, true, START - 8 * 60_000);
    expect(late.map((x) => x.type)).toEqual(['CONTEST_10M', 'CONTEST_CLOSED']);
    const after = planContestReminders(c, true, START + 60_000);
    expect(after.map((x) => x.type)).toEqual(['CONTEST_CLOSED']);
  });
  it('is stable so the DB unique key dedupes reruns', () => {
    expect(planContestReminders(c, true, START - 86_400_000 * 2)).toEqual(planContestReminders(c, true, START - 86_400_000 * 2));
  });
  it('messages are calm and never use banned phrases', () => {
    for (const t of ['CONTEST_24H', 'CONTEST_1H', 'CONTEST_10M', 'CONTEST_CLOSED', 'OBJECTIVE_COMPLETE', 'CONTEST_MISSED'] as const) {
      const msg = buildMessage(t, c, START - 10 * 60_000, 'Asia/Kolkata').body;
      expect(msg).not.toMatch(/grind|beast|streak|lazy|🔥/i);
    }
    expect(isStillRelevant('CONTEST_1H', c, START + 1)).toBe(false);
  });
});

describe('timezone', () => {
  it('converts UTC to the Asia/Kolkata calendar day', () => {
    // 2026-09-30T19:00Z is 00:30 IST on 10-01
    expect(dayKey(Date.UTC(2026, 8, 30, 19, 0), 'Asia/Kolkata')).toBe('2026-10-01');
    expect(dayKey(Date.UTC(2026, 8, 30, 18, 29), 'Asia/Kolkata')).toBe('2026-09-30');
  });
  it('day boundaries are midnight IST', () => {
    expect(dayStart('2026-09-30', 'Asia/Kolkata')).toBe(Date.UTC(2026, 8, 29, 18, 30));
    expect(dayEnd('2026-09-30', 'Asia/Kolkata')).toBe(Date.UTC(2026, 8, 30, 18, 30));
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('consistency', () => {
  it('computes rates and needs enough misses to name a bottleneck', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, state: (i % 5 === 0 ? 'MISSED' : 'COMPLETE') as any, requiredTotal: 2, requiredDone: i % 5 === 0 ? 0 : 2 }));
    const c = computeConsistency(days, [], '2026-09-30');
    expect(c.executionRate).toBe(80);
    expect(c.bottleneck).toBeNull();
    const cs = Array.from({ length: 3 }, () => ({ committed: true, attended: false, startHourLocal: 19, startMinuteLocal: 30 }));
    expect(computeConsistency(days, cs, '2026-09-30').bottleneck?.misses).toBe(3);
  });
});
