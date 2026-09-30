import { describe, expect, it } from 'vitest';
import { effectiveStatus } from '../src/services/state.js';

const H = 3_600_000;
const now = Date.now();

describe('source freshness never lies', () => {
  it('LIVE downgrades to SYNCED after ten minutes', () => {
    expect(effectiveStatus('codeforces', 'LIVE', new Date(now - 2 * 60_000), now)).toBe('LIVE');
    expect(effectiveStatus('codeforces', 'LIVE', new Date(now - 30 * 60_000), now)).toBe('SYNCED');
  });
  it('old data becomes STALE per platform window', () => {
    expect(effectiveStatus('codeforces', 'SYNCED', new Date(now - 7 * H), now)).toBe('STALE');
    expect(effectiveStatus('leetcode', 'IMPORTED', new Date(now - 47 * H), now)).toBe('IMPORTED');
    expect(effectiveStatus('leetcode', 'IMPORTED', new Date(now - 49 * H), now)).toBe('STALE');
  });
  it('ERROR is never masked', () => {
    expect(effectiveStatus('codeforces', 'ERROR', new Date(now), now)).toBe('ERROR');
  });
});
