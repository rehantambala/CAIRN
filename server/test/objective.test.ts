import { describe, expect, it } from 'vitest';
import { generateObjective, pickNext, selectProblems, solvedKey, type ObjectiveState, type PoolProblem } from '../src/domain/objective.js';
import { computeTrajectory } from '../src/domain/trajectory.js';
import { dayStart } from '../src/domain/time.js';
import { BASELINE } from './fixtures.js';

const DATE = '2026-09-30';
const NOW = dayStart(DATE) + 9 * 3_600_000;

function pool(): PoolProblem[] {
  const out: PoolProblem[] = [];
  for (let i = 0; i < 20; i++) {
    out.push({ platform: 'leetcode', externalId: `lc-${i}`, title: `LC ${i}`, url: `https://leetcode.com/problems/lc-${i}/`, difficulty: ['Easy', 'Medium', 'Hard'][i % 3], topic: 'Array' });
    out.push({ platform: 'codechef', externalId: `cc-${i}`, title: `CC ${i}`, url: `https://www.codechef.com/problems/CC${i}`, difficulty: String(1000 + i * 40), topic: null });
    out.push({ platform: 'codeforces', externalId: `cf-${i}`, title: `CF ${i}`, url: `https://codeforces.com/problemset/problem/1/${i}`, difficulty: String(800 + i * 50), topic: null });
  }
  return out;
}

function state(over: Partial<ObjectiveState> = {}): ObjectiveState {
  return {
    now: NOW, tz: 'Asia/Kolkata', date: DATE, scoreInputs: BASELINE,
    trajectory: computeTrajectory({ snapshots: [], now: NOW, targetDate: '2027-03-31' }),
    executionRate: 80, consecutiveComplete: 2, contests: [], solved: new Set(), pool: pool(),
    target: 25_000, platforms: ['leetcode', 'codechef', 'codeforces'],
    ...over,
  };
}

describe('daily objective', () => {
  it('is deterministic for the same state', () => {
    expect(generateObjective(state())).toEqual(generateObjective(state()));
  });

  it('is not a fixed count: the allocation responds to state', () => {
    const normal = generateObjective(state());
    const low = generateObjective(state({ executionRate: 30 }));
    const total = (o: ReturnType<typeof generateObjective>) => o.items.reduce((a, i) => a + (i.type === 'PROBLEM_QUOTA' ? i.quota : 0), 0);
    expect(total(low)).toBeLessThan(total(normal));
  });

  it('never suggests an already solved problem', () => {
    const solved = new Set(Array.from({ length: 10 }, (_, i) => solvedKey('leetcode', `lc-${i}`)));
    const o = generateObjective(state({ solved }));
    for (const it of o.items) for (const s of it.suggestions) expect(solved.has(solvedKey(s.platform, s.externalId))).toBe(false);
  });

  it('explains the CodeChef scoring threshold from real numbers', () => {
    const cc = generateObjective(state()).items.find((i) => i.platform === 'codechef');
    expect(cc?.reason).toMatch(/65 below the 1200/);
  });

  it('with an empty pool it points to the real practice page instead of inventing problems', () => {
    const o = generateObjective(state({ pool: pool().filter((p) => p.platform !== 'codeforces') }));
    const cf = o.items.find((i) => i.platform === 'codeforces');
    if (cf) {
      expect(cf.suggestions).toHaveLength(0);
      expect(cf.practiceUrl).toBe('https://codeforces.com/problemset');
      expect(cf.guidance).toMatch(/rated about/);
    }
  });

  it('adds a required contest item only when committed', () => {
    const c = { id: 'codechef:START1', platform: 'codechef' as const, title: 'Starters 1', startAt: dayStart(DATE) + 14.5 * 3_600_000, endAt: dayStart(DATE) + 16.5 * 3_600_000, rated: true, committed: false, registrationUrl: null, contestUrl: null };
    const open = generateObjective(state({ contests: [c] }));
    expect(open.items.find((i) => i.type === 'CONTEST')?.required).toBe(false);
    const committed = generateObjective(state({ contests: [{ ...c, committed: true }] }));
    expect(committed.items.find((i) => i.type === 'CONTEST')?.required).toBe(true);
    expect(committed.items.find((i) => i.type === 'CONTEST_PREP')).toBeDefined();
  });

  it('schedules REST after a long verified run', () => {
    const o = generateObjective(state({ consecutiveComplete: 6 }));
    expect(o.isRest).toBe(true);
  });

  it('selectProblems is stable and varies by date', () => {
    const a = selectProblems(pool(), new Set(), 'leetcode', 1373, 3, '2026-09-30').map((p) => p.externalId);
    const b = selectProblems(pool(), new Set(), 'leetcode', 1373, 3, '2026-09-30').map((p) => p.externalId);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });
});

describe('pickNext', () => {
  const c = { id: 'cf:1', platform: 'codeforces' as const, title: 'Round 1', startAt: NOW + 52 * 60_000, endAt: NOW + 172 * 60_000, rated: true, committed: true, registrationUrl: null, contestUrl: null };
  it('prefers a contest starting within 3 hours', () => {
    const o = generateObjective(state());
    const progress = o.items.map((item) => ({ item, done: 0, completed: false }));
    const n = pickNext(progress, [c], NOW, 'Asia/Kolkata');
    expect(n.kind).toBe('CONTEST');
    expect(n.detail).toMatch(/52 min/);
  });
  it('otherwise the first incomplete required item', () => {
    const o = generateObjective(state());
    const progress = o.items.map((item) => ({ item, done: 0, completed: false }));
    expect(pickNext(progress, [], NOW, 'Asia/Kolkata').kind).toBe('ITEM');
  });
  it('reports completion when everything required is done', () => {
    const o = generateObjective(state());
    const progress = o.items.map((item) => ({ item, done: item.quota, completed: true }));
    expect(pickNext(progress, [], NOW, 'Asia/Kolkata').kind).toBe('COMPLETE');
  });

  it('allocates nothing to platforms the user does not have', () => {
    const o = generateObjective(state({ platforms: ['codeforces'] }));
    const plats = new Set(o.items.filter((i) => i.type === 'PROBLEM_QUOTA').map((i) => i.platform));
    expect([...plats]).toEqual(['codeforces']);
  });
  it('allocates no work to a person with no profile and says why', () => {
    const o = generateObjective(state({ platforms: [] }));
    expect(o.items).toEqual([]);
    expect(o.rationale.join(' ')).toMatch(/No coding profile is connected/);
  });
});
