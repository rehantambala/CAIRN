import { pool, tx } from '../db/pool.js';
import { closePastDays, ensureObjective } from './derived.js';
import { deliverDue, scheduleAll, scheduleMissed } from './notify.js';
import { refreshAfterChange } from './pipeline.js';
import { discoverContests, syncPlatform } from './sync.js';
import { AUTOMATIC_PLATFORMS } from '../adapters/index.js';

export const JOB_NAMES = ['contests', 'sync', 'rollover', 'notify'] as const;
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
    case 'contests': {
      const r = await discoverContests(null, now);
      return { ...r };
    }
    case 'sync': {
      const out: unknown[] = [];
      for (const u of await users()) {
        // Every platform with an automatic adapter and a saved handle. One failing platform never blocks the others.
        for (const p of AUTOMATIC_PLATFORMS) {
          const connected = (await pool.query(`select 1 from platform_accounts where user_id=$1 and platform=$2 and username <> ''`, [u, p])).rowCount;
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

export async function runAll(now = Date.now()) {
  const out: Record<string, unknown> = {};
  for (const n of JOB_NAMES) {
    try { out[n] = await runJob(n, now); } catch (e: any) { out[n] = { error: String(e?.message ?? e) }; }
  }
  return out;
}
