import { randomUUID } from 'node:crypto';
import { pool, tx } from '../db/pool.js';
import { closePastDays, ensureObjective } from './derived.js';
import { deliverDue, scheduleAll, scheduleMissed } from './notify.js';
import { refreshAfterChange } from './pipeline.js';
import { discoverContests, syncPlatform } from './sync.js';
import { refreshPool } from './pool.js';
import { ensureAccounts, retryPending } from './accounts.js';
import { AUTOMATIC_PLATFORMS } from '../adapters/index.js';

export const JOB_NAMES = ['pool', 'contests', 'sync', 'rollover', 'notify'] as const;
export type JobName = (typeof JOB_NAMES)[number];

async function users(): Promise<string[]> {
  return (await pool.query('select id from users')).rows.map((r) => r.id);
}

/**
 * Every job is idempotent and delay-tolerant: it processes everything that is due up to `now`,
 * not "exactly at T", so a late run produces the same end state as an on-time one.
 */
export async function runJob(name: JobName, now = Date.now()): Promise<Record<string, unknown>> {
  switch (name) {
    case 'pool': return { ...(await refreshPool(pool, now)) };
    case 'contests': {
      const r = await discoverContests(null, now);
      return { ...r };
    }
    case 'sync': {
      const out: unknown[] = [];
      for (const u of await users()) {
        try { await ensureAccounts(u, now); } catch { /* housekeeping is best effort */ }
        try { out.push(...(await retryPending(u, now))); } catch { /* retried next run */ }
        // Every platform with an automatic adapter and a saved handle. One failing platform never blocks the others.
        for (const p of AUTOMATIC_PLATFORMS) {
          const connected = (await pool.query(`select 1 from platform_accounts where user_id=$1 and platform=$2 and username <> '' and connection_status='CONNECTED'`, [u, p])).rowCount;
          if (!connected) continue;
          try { out.push(await syncPlatform(u, p, now)); }
          catch (e: any) { out.push({ platform: p, ok: false, message: String(e?.message ?? e) }); }
        }
      }
      return { reports: out };
    }
    case 'rollover': {
      let closed = 0;
      for (const u of await users()) {
        await tx(async (c) => {
          closed += await closePastDays(c, u, now);
          await ensureObjective(c, u, now);
          await refreshAfterChange(c, u, now, 'rollover');
        });
      }
      return { closed };
    }
    case 'notify': {
      const res: unknown[] = [];
      for (const u of await users()) {
        const scheduled = await tx(async (c) => (await scheduleAll(c, u, now)) + (await scheduleMissed(c, u, now)));
        const delivered = await tx(async (c) => deliverDue(c, u, now));
        res.push({ scheduled, ...delivered });
      }
      return { users: res };
    }
  }
}

/**
 * Cross-process mutual exclusion for jobs. The in-process scheduler and the external cron can fire at the same
 * moment, possibly on different instances; a lease row in the database lets only one run of a given job proceed.
 * A lease left by a crashed run expires after 15 minutes. No connection is held while the job runs.
 */
const LEASE = "interval '15 minutes'";
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | { skipped: 'ALREADY_RUNNING' }> {
  const key = `job-lock:${name}`;
  const owner = randomUUID();
  const got = await pool.query(
    `insert into kv(key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now() where kv.updated_at < now() - ${LEASE}
     returning key`, [key, JSON.stringify({ owner })]);
  if (!got.rowCount) return { skipped: 'ALREADY_RUNNING' };
  try { return await fn(); }
  finally { await pool.query(`delete from kv where key = $1 and value->>'owner' = $2`, [key, owner]).catch(() => {}); }
}

/** Runs one job under its lease. Used by both the scheduler and the cron endpoint. */
export async function runJobExclusive(name: JobName, now = Date.now()): Promise<Record<string, unknown>> {
  return (await withJobLock(name, () => runJob(name, now))) as Record<string, unknown>;
}

export async function runAll(now = Date.now()) {
  const out: Record<string, unknown> = {};
  for (const n of JOB_NAMES) {
    // Failures are summarised by job; details go to the server log, never to the caller.
    try { out[n] = await runJobExclusive(n, now); } catch (e: any) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'job failed', job: n, error: String(e?.message ?? e) }));
      out[n] = { error: 'FAILED' };
    }
  }
  return out;
}
