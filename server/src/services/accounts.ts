import { config } from '../config.js';
import { pool } from '../db/pool.js';
import type { Db } from '../db/pool.js';
import type { Platform } from '../domain/types.js';
import { ADAPTERS } from '../adapters/index.js';
import { ProfileNotFound, type PlatformAdapter } from '../adapters/types.js';
import { syncPlatform, type SyncReport } from './sync.js';

/**
 * Coding profiles: connection, verification and disconnection, kept apart from sign-in and from statistics.
 * Coding platforms offer no "sign in with" grant to third parties, so a profile is connected by its public handle
 * and verified by the platform confirming that the handle exists. Handles found on a person's public GitHub
 * profile are only suggested ("detected"); nothing is connected without the person's confirmation.
 */
export type Handles = Partial<Record<'leetcode' | 'codechef' | 'codeforces', string>>;

const LEETCODE_RESERVED = new Set([
  'problems', 'problemset', 'contest', 'discuss', 'explore', 'study-plan', 'tag', 'company', 'submissions', 'accounts', 'interview',
  'assessment', 'store', 'premium', 'subscribe', 'api', 'graphql', 'list', 'playground', 'u', 'support', 'jobs', 'bugbounty', 'student',
]);

const PATTERNS: [keyof Handles, RegExp][] = [
  ['leetcode', /leetcode\.com\/(?:u\/)?([A-Za-z0-9_.-]{2,40})(?=[\/?#)\s"'<>\]]|$)/gi],
  ['codechef', /codechef\.com\/users\/([A-Za-z0-9_.-]{2,40})/gi],
  ['codeforces', /codeforces\.com\/profile\/([A-Za-z0-9_.-]{2,40})/gi],
];

/** Pure. The first plausible handle for each platform found in any of the supplied texts. */
export function extractHandles(texts: (string | null | undefined)[]): Handles {
  const out: Handles = {};
  for (const t of texts) {
    if (!t) continue;
    for (const [plat, re] of PATTERNS) {
      if (out[plat]) continue;
      re.lastIndex = 0;
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const h = m[1].replace(/[.]+$/, '');
        if (plat === 'leetcode' && LEETCODE_RESERVED.has(h.toLowerCase())) continue;
        out[plat] = h;
        break;
      }
    }
  }
  return out;
}

export type GetJson = (url: string, accept?: string) => Promise<unknown>;
const ghGet: GetJson = async (url, accept) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'cairn', Accept: accept ?? 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return accept === 'application/vnd.github.raw+json' ? res.text() : res.json();
};

/** Reads the owner's public GitHub profile, linked accounts and profile README. Each source may fail independently. */
export async function discoverFromGitHub(login: string, get: GetJson = ghGet): Promise<Handles> {
  const texts: string[] = [];
  const grab = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* a missing source is not an error */ } };
  await grab(async () => { const u = (await get(`https://api.github.com/users/${encodeURIComponent(login)}`)) as any; texts.push(u?.bio, u?.blog); });
  await grab(async () => { const a = (await get(`https://api.github.com/users/${encodeURIComponent(login)}/social_accounts`)) as any[]; for (const x of a ?? []) texts.push(x?.url); });
  await grab(async () => { texts.push((await get(`https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`, 'application/vnd.github.raw+json')) as string); });
  return extractHandles(texts);
}

export const HANDLE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

export interface ConnectResult {
  ok: boolean;
  state: 'CONNECTED' | 'PENDING' | 'MANUAL' | 'NOT_FOUND' | 'INVALID';
  handle: string | null;
  message: string;
  report?: SyncReport;
}

/**
 * Connects a profile for the signed-in user. Automatic sources verify the handle with the platform first:
 * a handle the platform does not know is refused and nothing is saved; an unreachable source leaves the
 * profile PENDING, and verification is retried by the scheduled job. Manual sources keep the handle as stated.
 */
export async function connectProfile(db: Db, userId: string, platform: Platform, raw: string, now = Date.now(), adapter: PlatformAdapter = ADAPTERS[platform]): Promise<ConnectResult> {
  const handle = raw.trim().replace(/^@/, '');
  if (!HANDLE_RE.test(handle)) return { ok: false, state: 'INVALID', handle: null, message: 'That is not a valid handle.' };
  const save = (h: string, status: string, verified: boolean, error: string | null) => db.query(
    `insert into platform_accounts(user_id, platform, username, connection_status, verified_at, last_error, disconnected_at)
     values ($1,$2,$3,$4, case when $5 then $6::timestamptz end, $7, null)
     on conflict (user_id, platform) do update set username=excluded.username, connection_status=excluded.connection_status,
       verified_at = case when $5 then $6::timestamptz else platform_accounts.verified_at end,
       last_error=excluded.last_error, disconnected_at=null, updated_at=now()`,
    [userId, platform, h, status, verified, new Date(now), error]);
  await clearDetected(db, userId, platform);

  if (adapter.capability !== 'AUTOMATIC' || !adapter.getProfile) {
    await save(handle, 'MANUAL', false, null);
    return { ok: true, state: 'MANUAL', handle, message: 'Handle recorded. This platform cannot be read automatically; enter its figures to include it in the score.' };
  }
  let canonical = handle;
  try {
    canonical = (await adapter.getProfile(handle)).handle || handle;
  } catch (e) {
    if (e instanceof ProfileNotFound) return { ok: false, state: 'NOT_FOUND', handle, message: e.message };
    await save(handle, 'PENDING', false, String((e as Error).message).slice(0, 200));
    return { ok: true, state: 'PENDING', handle, message: 'The platform could not be reached. The profile is pending verification and will be checked again automatically.' };
  }
  await save(canonical, 'CONNECTED', true, null);
  const report = await syncPlatform(userId, platform, now, adapter);
  return { ok: true, state: 'CONNECTED', handle: canonical, report,
    message: report.ok ? 'Profile verified and synchronised.' : `Profile verified. The first synchronisation did not complete: ${report.message}` };
}

/** Stops synchronisation. History, figures and score snapshots are kept. */
export async function disconnectProfile(db: Db, userId: string, platform: Platform): Promise<void> {
  await db.query(
    `update platform_accounts set username='', connection_status='DISCONNECTED', disconnected_at=now(), last_error=null, updated_at=now()
      where user_id=$1 and platform=$2`, [userId, platform]);
  await db.query(`update platform_stats set source_note='Disconnected. The last verified figures are retained.' where user_id=$1 and platform=$2`, [userId, platform]);
}

/** Re-verifies profiles left PENDING by an unreachable source. */
export async function retryPending(userId: string, now = Date.now()): Promise<ConnectResult[]> {
  const rows = (await pool.query(`select platform, username from platform_accounts where user_id=$1 and connection_status='PENDING' and username <> ''`, [userId])).rows;
  const out: ConnectResult[] = [];
  for (const r of rows) {
    const res = await connectProfile(pool, userId, r.platform, r.username, now);
    // A handle the platform now says does not exist is not kept pending for ever.
    if (res.state === 'NOT_FOUND') await pool.query(`update platform_accounts set connection_status='ERROR', last_error=$3 where user_id=$1 and platform=$2`, [userId, r.platform, res.message]);
    out.push(res);
  }
  return out;
}

// ---------- detected handles (suggestions only) ----------

const detectedKey = (userId: string) => `detected:${userId}`;

export async function getDetected(db: Db, userId: string): Promise<Handles> {
  return ((await db.query('select value from kv where key=$1', [detectedKey(userId)])).rows[0]?.value ?? {}) as Handles;
}
async function clearDetected(db: Db, userId: string, platform: Platform) {
  await db.query(`update kv set value = value - $2 where key=$1`, [detectedKey(userId), platform]);
}

/** Reads the user's own public GitHub profile and records handles for platforms not yet connected. */
export async function detectFromGitHub(db: Db, userId: string, get?: GetJson): Promise<Handles> {
  const gh = (await db.query('select github_login from users where id=$1', [userId])).rows[0]?.github_login as string | null;
  if (!gh) return {};
  const found = await discoverFromGitHub(gh, get);
  const have = new Set((await db.query(`select platform from platform_accounts where user_id=$1 and username <> ''`, [userId])).rows.map((r) => r.platform));
  const fresh: Handles = {};
  for (const [p, h] of Object.entries(found) as [keyof Handles, string][]) if (!have.has(p)) fresh[p] = h;
  await db.query(`insert into kv(key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value=excluded.value, updated_at=now()`,
    [detectedKey(userId), JSON.stringify(fresh)]);
  return fresh;
}

/**
 * Housekeeping before each scheduled synchronisation. Handles from configuration apply to the bootstrap owner
 * (OWNER_EMAIL) only and are verified like any other; GitHub detection runs at most once a day.
 */
export async function ensureAccounts(userId: string, now = Date.now(), get?: GetJson): Promise<void> {
  const email = (await pool.query('select email from users where id=$1', [userId])).rows[0]?.email as string | null;
  if (config.ownerEmail && email && email.toLowerCase() === config.ownerEmail) {
    const rows = (await pool.query(`select platform, username, disconnected_at from platform_accounts where user_id=$1`, [userId])).rows;
    for (const k of ['leetcode', 'codechef', 'codeforces'] as const) {
      const r = rows.find((x) => x.platform === k);
      // Never re-attach a profile the owner deliberately disconnected.
      if (config.handles[k] && !r?.username && !r?.disconnected_at) await connectProfile(pool, userId, k, config.handles[k], now);
    }
  }
  const key = `detect-run:${userId}`;
  const last = (await pool.query('select updated_at from kv where key=$1', [key])).rows[0]?.updated_at as Date | undefined;
  if (!last || now - last.getTime() > 20 * 3_600_000) {
    await pool.query(`insert into kv(key, updated_at) values ($1,$2) on conflict (key) do update set updated_at=excluded.updated_at`, [key, new Date(now)]);
    await detectFromGitHub(pool, userId, get).catch(() => ({}));
  }
}
