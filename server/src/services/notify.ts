import webpush from 'web-push';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { buildMessage, isStillRelevant, planContestReminders, type ContestLite, type NotificationType } from '../domain/notifications.js';
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

async function contestLite(db: Db, id: string): Promise<ContestLite | null> {
  const r = (await db.query('select * from contests where id=$1', [id])).rows[0];
  if (!r) return null;
  return { id: r.id, platform: r.platform, title: r.title, startAt: r.start_at.getTime(), endAt: r.end_at.getTime() };
}

/** Plans reminders for tracked contests in the next 14 days. Unique (user,type,key) makes reruns no-ops. */
export async function scheduleAll(db: Db, userId: string, now: number): Promise<number> {
  const rows = (await db.query(
    `select c.*, (cm.id is not null) as committed from contests c
       left join contest_commitments cm on cm.contest_id = c.id and cm.user_id = $1
      where c.rated and c.end_at > $2 and c.start_at < $3`,
    [userId, new Date(now), new Date(now + 14 * 86_400_000)],
  )).rows;
  let inserted = 0;
  for (const r of rows) {
    const c: ContestLite = { id: r.id, platform: r.platform, title: r.title, startAt: r.start_at.getTime(), endAt: r.end_at.getTime() };
    for (const p of planContestReminders(c, r.committed, now)) {
      const res = await db.query(
        `insert into notifications(user_id, type, dedupe_key, scheduled_for, payload_json)
         values ($1,$2,$3,$4,$5) on conflict (user_id, type, dedupe_key) do nothing returning id`,
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

/** Delivers everything due. Delayed runs deliver late; expired moments are SKIPPED, never sent stale. */
export async function deliverDue(db: Db, userId: string, now: number): Promise<DeliverResult> {
  const user = await getUser(db, userId);
  const due = (await db.query(
    `select * from notifications where user_id=$1 and status='PENDING' and scheduled_for <= $2 order by scheduled_for`,
    [userId, new Date(now)],
  )).rows;
  const subs = (await db.query('select * from push_subscriptions where user_id=$1', [userId])).rows;
  const out: DeliverResult = { due: due.length, delivered: 0, skipped: 0, failed: 0 };
  const canPush = initPush();

  for (const n of due) {
    const contest = n.payload_json?.contestId ? await contestLite(db, n.payload_json.contestId) : null;
    if (!isStillRelevant(n.type as NotificationType, contest, now)) {
      await db.query(`update notifications set status='SKIPPED', payload_json = payload_json || '{"reason":"EXPIRED"}' where id=$1`, [n.id]);
      out.skipped++;
      continue;
    }
    const msg = buildMessage(n.type as NotificationType, contest, now, user.timezone);
    const payload = JSON.stringify(msg);
    let sent = 0;
    if (canPush) {
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
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
      const reason = !canPush ? 'PUSH_NOT_CONFIGURED' : subs.length === 0 ? 'NO_SUBSCRIPTION' : 'SEND_FAILED';
      await db.query(
        `update notifications set status = $2, payload_json = payload_json || $3::jsonb where id=$1`,
        [n.id, reason === 'SEND_FAILED' ? 'FAILED' : 'SKIPPED', JSON.stringify({ reason, message: msg })],
      );
      reason === 'SEND_FAILED' ? out.failed++ : out.skipped++;
    }
  }
  return out;
}
