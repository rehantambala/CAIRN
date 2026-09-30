import type { DayState, Verification } from './types.js';

export interface DayItem {
  required: boolean;
  completed: boolean;
  verification: Verification;
}

export interface DayInput {
  isRest: boolean;
  isToday: boolean;
  items: DayItem[];
}

export interface DayResult {
  state: DayState;
  /** every completed required item is VERIFIED (vs MANUAL) */
  verified: boolean;
  requiredTotal: number;
  requiredDone: number;
}

/**
 * COMPLETE only when all required items are done. A past day with none done is
 * MISSED, with some done PARTIAL. Today is ACTIVE until complete.
 * Opening the app or viewing a problem never changes state: only item
 * completion does, and completion comes from the accepted-problem pipeline.
 */
export function dayState(d: DayInput): DayResult {
  const req = d.items.filter((i) => i.required);
  const done = req.filter((i) => i.completed);
  const verified = done.every((i) => i.verification === 'VERIFIED');
  const base = { requiredTotal: req.length, requiredDone: done.length, verified };

  if (d.isRest) return { ...base, state: 'REST' };
  if (req.length > 0 && done.length === req.length) return { ...base, state: 'COMPLETE' };
  if (d.isToday) return { ...base, state: 'ACTIVE' };
  if (req.length === 0) return { ...base, state: 'REST' };
  return { ...base, state: done.length === 0 ? 'MISSED' : 'PARTIAL' };
}

export const DAY_GLYPH: Record<DayState, string> = {
  COMPLETE: '●', ACTIVE: '◐', PARTIAL: '◒', MISSED: '×', REST: '–',
};
