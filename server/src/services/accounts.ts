import { config } from '../config.js';
import { pool } from '../db/pool.js';
import type { Db } from '../db/pool.js';
import type { Platform } from '../domain/types.js';
import { AUTOMATIC_PLATFORMS } from '../adapters/index.js';
import { syncPlatform, type SyncReport } from './sync.js';

/**
 * Finding a person's handles without asking them to type them. Coding platforms offer no "sign in with" grant to
 * third parties, so the dependable route is the public record the owner has already published: GitHub profile,
 * linked accounts and profile README. Only public information is read.
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
  const res = await fetch(url, { headers: { 'User-Agent': 'cairn-personal', Accept: accept ?? 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
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

/** Saves handles for platforms that have none yet. Never overwrites a handle the owner chose. */
export async function saveHandles(db: Db, userId: string, handles: Handles, overwrite = false): Promise<Platform[]> {
  const saved: Platform[] = [];
  for (const [plat, h] of Object.entries(handles) as [Platform, string][]) {
    if (!h) continue;
    const r = await db.query(
      `insert into platform_accounts(user_id, platform, username, connection_status) values ($1,$2,$3,'CONNECTED')
       on conflict (user_id, platform) do update set username = excluded.username, connection_status='CONNECTED', updated_at=now()
         where $4::boolean or platform_accounts.username = ''
       returning id`,
      [userId, plat, h, overwrite],
    );
    if (r.rows[0]) saved.push(plat);
  }
  return saved;
}

export async function connectAndSync(userId: string, handles: Handles, overwrite = false): Promise<{ saved: Platform[]; reports: SyncReport[] }> {
  const saved = await saveHandles(pool, userId, handles, overwrite);
  const reports: SyncReport[] = [];
  for (const p of saved) if (AUTOMATIC_PLATFORMS.includes(p)) reports.push(await syncPlatform(userId, p));
  return { saved, reports };
}

/**
 * Run before every scheduled synchronisation. Configuration first, then GitHub (at most once a day, and only
 * while a platform is still unconnected), so that after the one-time sign-in nothing is ever typed or saved.
 */
export async function ensureAccounts(userId: string, now = Date.now(), get?: GetJson): Promise<Platform[]> {
  const env: Handles = {};
  for (const k of ['leetcode', 'codechef', 'codeforces'] as const) if (config.handles[k]) env[k] = config.handles[k];
  let saved = await saveHandles(pool, userId, env);
  const missing = (await pool.query(`select count(*)::int n from platform_accounts where user_id=$1 and platform in ('leetcode','codechef','codeforces') and username <> ''`, [userId])).rows[0].n < 3;
  const gh = (await pool.query('select github_login from users where id=$1', [userId])).rows[0]?.github_login as string | null;
  if (missing && gh) {
    const key = `discover:${userId}`;
    const last = (await pool.query('select updated_at from kv where key=$1', [key])).rows[0]?.updated_at as Date | undefined;
    if (!last || now - last.getTime() > 20 * 3_600_000) {
      await pool.query(`insert into kv(key, updated_at) values ($1,$2) on conflict (key) do update set updated_at=excluded.updated_at`, [key, new Date(now)]);
      saved = saved.concat(await saveHandles(pool, userId, await discoverFromGitHub(gh, get)));
    }
  }
  return saved;
}
