import webpush from 'web-push';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { buildMessage, expectedAt, isStillRelevant, planContestReminders, type ContestLite, type NotificationType, type ReminderPrefs } from '../domain/notifications.js';
import { isAllowedPushEndpoint } from '../domain/pushEndpoint.js';
import { getUser, recordEvent } from './state.js';

let vapidReady = false;
function initPush(): boolean {
  if (vapidReady) return true;
  if (!config.vapidPublic || !config.vapidPrivate) return false;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
  vapidReady = true;
  return true;
}
export const pushConfigured = () => !!(config.vapidPublic && config.vapidPrivate);

async function contestLite(db: Db, id: string): Promise<(ContestLite & { cancelled: boolean }) | null> {
  const r = (await db.query('select * from contests where id=$1', [id])).rows[0];
  if (!r) return null;
  return { id: r.id, platform: r.platform, title: r.title, startAt: r.start_at.getTime(), endAt: r.end_at.getTime(), cancelled: !!r.cancelled_at };
}

/** Delivery is replaceable (tests, other channels); the default is Web Push. */
export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export type Sender = (target: PushTarget, payload: string) => Promise<void>;
export const webPushSender: Sender = async (t, payload) => {
  if (!initPush()) throw Object.assign(new Error('PUSH_NOT_CONFIGURED'), { notConfigured: true });
  await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload);
};

/** Plans this user's reminders for contests in the next 14 days. Unique (user,type,key) makes reruns no-ops. */
export async function scheduleAll(db: Db, userId: string, now: number): Promise<number> {
  const u = (await db.query('select remind_enabled, remind_24h, remind_1h, remind_10m from users where id=$1', [userId])).rows[0];
  if (!u) return 0;
  const prefs: ReminderPrefs = { enabled: u.remind_enabled, h24: u.remind_24h, h1: u.remind_1h, m10: u.remind_10m };
  const mine = new Set((await db.query(
    `select platform from platform_stats where user_id=$1 union select platform from platform_accounts where user_id=$1 and username <> ''`, [userId],
  )).rows.map((r) => r.platform as string));
  const rows = (await db.query(
    `select c.*, (cm.id is not null) as committed from contests c
       left join contest_commitments cm on cm.contest_id = c.id and cm.user_id = $1
      where c.rated and c.cancelled_at is null and c.end_at > $2 and c.start_at < $3`,
    [userId, new Date(now), new Date(now + 14 * 86_400_000)],
  )).rows;
  let inserted = 0;
  for (const r of rows) {
    const c: ContestLite = { id: r.id, platform: r.platform, title: r.title, startAt: r.start_at.getTime(), endAt: r.end_at.getTime() };
    for (const p of planContestReminders(c, r.committed, now, prefs, mine.has(c.platform))) {
      // A reminder withdrawn by a preference change comes back if the preference is restored, and a pending one
      // follows its contest if the platform moves it. Nothing already sent is ever resent.
      const res = await db.query(
        `insert into notifications(user_id, type, dedupe_key, scheduled_for, payload_json)
         values ($1,$2,$3,$4,$5) on conflict (user_id, type, dedupe_key) do update
           set status='PENDING', scheduled_for=excluded.scheduled_for, payload_json=excluded.payload_json
           where (notifications.status='SKIPPED' and notifications.payload_json->>'reason' in ('PREFERENCE', 'CANCELLED'))
              or (notifications.status='PENDING' and notifications.scheduled_for <> excluded.scheduled_for)
         returning id`,
        [userId, p.type, p.key, new Date(p.scheduledFor), JSON.stringify({ contestId: c.id })],
      );
      if (res.rows[0]) {
        inserted++;
        await recordEvent(db, userId, 'REMINDER_SCHEDULED', c.platform, c.id, { type: p.type, at: p.scheduledFor });
      }
    }
  }
  return inserted;
}

export async function scheduleObjectiveComplete(db: Db, userId: string, date: string, now: number) {
  await db.query(
    `insert into notifications(user_id, type, dedupe_key, scheduled_for, payload_json)
     values ($1,'OBJECTIVE_COMPLETE',$2,$3,'{}') on conflict (user_id, type, dedupe_key) do nothing`,
    [userId, date, new Date(now)],
  );
}

export async function scheduleMissed(db: Db, userId: string, now: number): Promise<number> {
  // Committed contests that ended 6+ hours ago with no participation: one calm notice, no retroactive credit.
  const rows = (await db.query(
    `select c.id, c.platform from contest_commitments cm
       join contests c on c.id = cm.contest_id
       left join contest_participations cp on cp.contest_id = c.id and cp.user_id = cm.user_id
      where cm.user_id = $1 and c.end_at < $2 and c.end_at > $3 and cp.id is null`,
    [userId, new Date(now - 6 * 3_600_000), new Date(now - 3 * 86_400_000)],
  )).rows;
  let n = 0;
  for (const r of rows) {
    const res = await db.query(
      `insert into notifications(user_id, type, dedupe_key, scheduled_for, payload_json)
       values ($1,'CONTEST_MISSED',$2,$3,$4) on conflict (user_id, type, dedupe_key) do nothing returning id`,
      [userId, r.id, new Date(now), JSON.stringify({ contestId: r.id })],
    );
    if (res.rows[0]) n++;
  }
  return n;
}

export interface DeliverResult { due: number; delivered: number; skipped: number; failed: number }
const MAX_ATTEMPTS = 3;

/**
 * Delivers everything due for one user. Rows are claimed with FOR UPDATE SKIP LOCKED inside the caller's
 * transaction, so two workers running at once (the minute tick and the external cron) never send the same
 * reminder twice. Delayed runs deliver late; expired moments are SKIPPED, never sent stale.
 */
export async function deliverDue(db: Db, userId: string, now: number, send: Sender = webPushSender): Promise<DeliverResult> {
  const user = await getUser(db, userId);
  const due = (await db.query(
    `select * from notifications where user_id=$1 and status='PENDING' and scheduled_for <= $2 order by scheduled_for for update skip locked`,
    [userId, new Date(now)],
  )).rows;
  const subs = (await db.query('select * from push_subscriptions where user_id=$1', [userId])).rows;
  const out: DeliverResult = { due: due.length, delivered: 0, skipped: 0, failed: 0 };
  const canPush = send !== webPushSender || pushConfigured();

  const prefs = (await db.query('select remind_enabled, remind_24h, remind_1h, remind_10m from users where id=$1', [userId])).rows[0];
  const wanted: Record<string, boolean> = prefs ? {
    CONTEST_24H: prefs.remind_enabled && prefs.remind_24h, CONTEST_1H: prefs.remind_enabled && prefs.remind_1h, CONTEST_10M: prefs.remind_enabled && prefs.remind_10m,
  } : {};
  // Only the browsers' own push services are ever contacted; anything else stored before validation existed is removed.
  const targets = [];
  for (const s of subs) {
    if (isAllowedPushEndpoint(s.endpoint)) targets.push(s);
    else await db.query('delete from push_subscriptions where id=$1', [s.id]);
  }
  const skip = async (id: string, reason: string) => {
    await db.query(`update notifications set status='SKIPPED', payload_json = payload_json || $2::jsonb where id=$1`, [id, JSON.stringify({ reason })]);
    out.skipped++;
  };

  for (const n of due) {
    const contest = n.payload_json?.contestId ? await contestLite(db, n.payload_json.contestId) : null;
    if (contest?.cancelled) { await skip(n.id, 'CANCELLED'); continue; }
    if (n.type in wanted && !wanted[n.type]) { await skip(n.id, 'PREFERENCE'); continue; }
    if (!isStillRelevant(n.type as NotificationType, contest, now)) { await skip(n.id, 'EXPIRED'); continue; }
    // The contest was moved later since this was planned: follow it rather than send early.
    const due2 = contest ? expectedAt(n.type as NotificationType, contest) : null;
    if (due2 !== null && due2 > now + 60_000) {
      await db.query('update notifications set scheduled_for=$2 where id=$1', [n.id, new Date(due2)]);
      out.due--;
      continue;
    }
    const msg = buildMessage(n.type as NotificationType, contest, now, user.timezone);
    const payload = JSON.stringify(msg);
    let sent = 0;
    if (canPush) {
      for (const s of targets) {
        try {
          await send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
          sent++;
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.query('delete from push_subscriptions where id=$1', [s.id]);
        }
      }
    }
    if (sent > 0) {
      await db.query(
        `update notifications set status='DELIVERED', delivered_at=$2, payload_json = payload_json || $3::jsonb where id=$1`,
        [n.id, new Date(now), JSON.stringify({ message: msg })],
      );
      await recordEvent(db, userId, 'REMINDER_DELIVERED', contest?.platform ?? null, n.id, { type: n.type });
      out.delivered++;
    } else {
      // Nothing was actually pushed. Record the message for the in-app feed and say so honestly.
      const reason = !canPush ? 'PUSH_NOT_CONFIGURED' : targets.length === 0 ? 'NO_SUBSCRIPTION' : 'SEND_FAILED';
      const attempts = Number(n.payload_json?.attempts ?? 0) + 1;
      if (reason === 'SEND_FAILED' && attempts < MAX_ATTEMPTS) {
        // A push service hiccup: tried again on the next run (a minute later) while the moment is still relevant.
        await db.query(`update notifications set scheduled_for = $2, payload_json = payload_json || $3::jsonb where id=$1`,
          [n.id, new Date(now + 60_000), JSON.stringify({ attempts })]);
        out.failed++;
        continue;
      }
      await db.query(
        `update notifications set status = $2, payload_json = payload_json || $3::jsonb where id=$1`,
        [n.id, reason === 'SEND_FAILED' ? 'FAILED' : 'SKIPPED', JSON.stringify({ reason, message: msg, attempts })],
      );
      reason === 'SEND_FAILED' ? out.failed++ : out.skipped++;
    }
  }
  return out;
}
