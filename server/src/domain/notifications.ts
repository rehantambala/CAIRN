import { BRAND } from './brand.js';
import { hourMinute } from './time.js';
import { PLATFORM_LABEL, type Platform } from './types.js';

export type NotificationType =
  | 'CONTEST_24H' | 'CONTEST_1H' | 'CONTEST_10M' | 'CONTEST_CLOSED'
  | 'OBJECTIVE_COMPLETE' | 'CONTEST_MISSED';

export interface ContestLite {
  id: string;
  platform: Platform;
  title: string;
  startAt: number;
  endAt: number;
}

export interface Planned {
  type: NotificationType;
  key: string; // dedupe key: one row per (type, key)
  scheduledFor: number;
}

const MIN = 60_000;

/**
 * Reminders for a contest. 24h is sent for any tracked contest; 1h, 10m and
 * closed only when the user has committed. Delayed jobs are tolerated: a slot
 * whose time has passed is still planned as long as the moment it refers to
 * has not passed yet, and is delivered at the next run ("about" wording).
 */
export function planContestReminders(c: ContestLite, committed: boolean, now: number): Planned[] {
  const out: Planned[] = [];
  const key = c.id;
  if (now < c.startAt - 12 * 60 * MIN) {
    out.push({ type: 'CONTEST_24H', key, scheduledFor: c.startAt - 24 * 60 * MIN });
  }
  if (committed) {
    if (now < c.startAt - 30 * MIN) out.push({ type: 'CONTEST_1H', key, scheduledFor: c.startAt - 60 * MIN });
    if (now < c.startAt) out.push({ type: 'CONTEST_10M', key, scheduledFor: c.startAt - 10 * MIN });
    out.push({ type: 'CONTEST_CLOSED', key, scheduledFor: c.endAt });
  }
  return out;
}

export interface Message { title: string; body: string; url: string }

export function buildMessage(
  type: NotificationType, c: ContestLite | null, now: number, tz: string,
): Message {
  const name = c ? `${PLATFORM_LABEL[c.platform]} ${c.title}` : '';
  const link = c ? `/contests?focus=${encodeURIComponent(c.id)}` : '/today';
  switch (type) {
    case 'CONTEST_24H':
      return { title: BRAND, url: link,
        body: `${name || 'A rated contest'} begins tomorrow${c ? ` at ${hourMinute(c.startAt, tz)}` : ''}. A rated attempt is the only route to rating movement; committing schedules your preparation.` };
    case 'CONTEST_1H':
      return { title: BRAND, url: link,
        body: `${name || 'Your contest'} begins in about one hour. Preparation should start now, so that the attempt begins from a settled position.` };
    case 'CONTEST_10M': {
      const mins = c ? Math.max(0, Math.round((c.startAt - now) / MIN)) : 10;
      return { title: BRAND, url: link,
        body: mins > 0
          ? `${name || 'Your contest'} begins in about ${mins} minutes. The rated window is about to open.`
          : `${name || 'Your contest'} is about to begin. The rated window is open.` };
    }
    case 'CONTEST_CLOSED':
      return { title: BRAND, url: link, body: `${name || 'The contest'} has closed. Your result will be synchronised shortly.` };
    case 'OBJECTIVE_COMPLETE':
      return { title: BRAND, url: '/calendar', body: "Today's objective is complete, and the execution is recorded." };
    case 'CONTEST_MISSED':
      return { title: BRAND, url: '/contests',
        body: 'A committed contest was not attended, and no credit is given retrospectively. The next rated contest has been identified.' };
  }
}

/** A planned reminder is due when its time has arrived and its moment is still relevant. */
export function isStillRelevant(type: NotificationType, c: ContestLite | null, now: number): boolean {
  if (!c) return true;
  if (type === 'CONTEST_24H' || type === 'CONTEST_1H' || type === 'CONTEST_10M') return now < c.startAt;
  return true;
}
