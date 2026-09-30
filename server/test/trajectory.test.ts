import { describe, expect, it } from 'vitest';
import { computeTrajectory, dailySeries } from '../src/domain/trajectory.js';
import { addDays, dayStart } from '../src/domain/time.js';

const TODAY = '2026-09-30';
const at = (day: string, hour = 12) => dayStart(day) + hour * 3_600_000;
const NOW = at(TODAY, 20);

function steady(days: number, perDay: number, start = 12_000) {
  const out = [];
  for (let i = days; i >= 0; i--) out.push({ at: at(addDays(TODAY, -i)), score: start + (days - i) * perDay });
  return out;
}

describe('trajectory', () => {
  it('reports INSUFFICIENT DATA without enough history', () => {
    const t = computeTrajectory({ snapshots: steady(3, 50), now: NOW, targetDate: '2027-03-31' });
    expect(t.status).toBe('INSUFFICIENT DATA');
    expect(t.velocity).toBeNull();
    expect(t.projectedDate).toBeNull();
  });

  it('classifies pace against required velocity', () => {
    const base = { now: NOW, targetDate: '2027-03-31' };
    const fast = computeTrajectory({ ...base, snapshots: steady(14, 120) });
    const slow = computeTrajectory({ ...base, snapshots: steady(14, 10) });
    expect(fast.status).toBe('AHEAD');
    expect(slow.status).toBe('PACE DEFICIT');
    expect(slow.projectedDate).not.toBeNull();
  });

  it('a single huge jump does not drive the velocity', () => {
    const snaps = steady(14, 20);
    // one +3000 jump on day 7
    const jumped = snaps.map((s, i) => (i >= 7 ? { ...s, score: s.score + 3000 } : s));
    const t = computeTrajectory({ snapshots: jumped, now: NOW, targetDate: '2027-03-31' });
    expect(t.velocity!).toBeLessThan(60);
  });

  it('carries the last score across days with no snapshot', () => {
    const s = dailySeries([{ at: at('2026-09-27'), score: 100 }, { at: at('2026-09-29'), score: 130 }], TODAY);
    expect(s.map((x) => x.score)).toEqual([100, 100, 130, 130]);
  });

  it('needs a target date to call pace', () => {
    const t = computeTrajectory({ snapshots: steady(14, 50), now: NOW });
    expect(t.status).toBe('INSUFFICIENT DATA');
    expect(t.note).toMatch(/target date/i);
  });

  it('reached objective is complete', () => {
    const t = computeTrajectory({ snapshots: [{ at: at(TODAY), score: 25_100 }], now: NOW, targetDate: '2027-03-31' });
    expect(t.reached).toBe(true);
    expect(t.note).toBe('OBJECTIVE COMPLETED');
  });
});
