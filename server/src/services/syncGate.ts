import { pool } from '../db/pool.js';
import type { Platform } from '../domain/types.js';
import { ADAPTERS } from '../adapters/index.js';
import { syncPlatform, type SyncReport } from './sync.js';

/**
 * User-triggered synchronisation, protected against abuse of the platforms' own rate limits:
 *  - concurrent requests for the same person and platform share one run (ten clicks, one request upstream);
 *  - a platform synchronised less than a minute ago is not read again; the last result stands.
 * The scheduled job calls syncPlatform directly and is serialised by its own lease.
 */
export const SYNC_COOLDOWN_MS = 60_000;
const inFlight = new Map<string, Promise<SyncReport>>();

export async function requestSync(userId: string, platform: Platform, now = Date.now(), adapter = ADAPTERS[platform]): Promise<SyncReport & { cached?: boolean }> {
  const key = `${userId}:${platform}`;
  const running = inFlight.get(key);
  if (running) return running;
  const last = (await pool.query('select last_synced_at from platform_accounts where user_id=$1 and platform=$2', [userId, platform])).rows[0]?.last_synced_at as Date | null | undefined;
  if (last && now - last.getTime() < SYNC_COOLDOWN_MS) {
    return { platform, ok: true, message: 'RECENTLY_SYNCED', newProblems: 0, newParticipations: 0, cached: true };
  }
  const p = syncPlatform(userId, platform, now, adapter).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
