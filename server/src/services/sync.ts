import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { pool, tx } from '../db/pool.js';
import type { Db } from '../db/pool.js';
import { ADAPTERS } from '../adapters/index.js';
import { clistConfigured, fetchClistContests } from '../adapters/clist.js';
import { fetchCodeChefContests, fetchLeetCodeContests } from '../adapters/contestfeeds.js';
import type { NormalizedContest, NormalizedSubmission, PlatformAdapter, Totals } from '../adapters/types.js';
import { ingestAccepted, refreshAfterChange } from './pipeline.js';
import { recordParticipation, recordRating, upsertContest } from './contests.js';
import { recordEvent } from './state.js';
import { rebaseline } from './baseline.js';
import type { Platform } from '../domain/types.js';

export interface SyncReport { platform: Platform; ok: boolean; message: string; newProblems: number; newParticipations: number }

async function setStatus(db: Db, userId: string, platform: Platform, status: string, note: string | null, touch: boolean) {
  await db.query(
    `insert into platform_stats(user_id, platform, source_status, source_note, last_updated_at)
     values ($1,$2,$3,$4,now())
     on conflict (user_id, platform) do update set source_status=excluded.source_status, source_note=excluded.source_note,
       last_updated_at = case when $5 then now() else platform_stats.last_updated_at end`,
    [userId, platform, status, note, touch],
  );
}

/**
 * Sync one platform. On failure the existing data is kept untouched and the status becomes ERROR;
 * an empty or failed response never overwrites valid data.
 */
export async function syncPlatform(userId: string, platform: Platform, now = Date.now(), adapter: PlatformAdapter = ADAPTERS[platform]): Promise<SyncReport> {
  const rep: SyncReport = { platform, ok: false, message: '', newProblems: 0, newParticipations: 0 };
  if (adapter.capability !== 'AUTOMATIC' || !adapter.getProfile) {
    rep.message = 'No automatic route exists for this platform. Use the import form.';
    return rep;
  }
  const acct = (await pool.query('select username, connection_status from platform_accounts where user_id=$1 and platform=$2', [userId, platform])).rows[0];
  if (!acct?.username || acct.connection_status !== 'CONNECTED') { rep.message = 'Not connected. Connect the profile in Preferences.'; return rep; }
  const handle: string = acct.username;

  let profile, submissions: NormalizedSubmission[], history, contests, totals: Totals | null;
  try {
    profile = await adapter.getProfile(handle);
    submissions = adapter.getSubmissions ? await adapter.getSubmissions(handle) : [];
    history = adapter.getRatingHistory ? await adapter.getRatingHistory(handle) : [];
    contests = adapter.getContests ? await adapter.getContests() : [];
    totals = adapter.getTotals ? await adapter.getTotals(handle) : null;
  } catch (e: any) {
    await setStatus(pool, userId, platform, 'ERROR', String(e?.message ?? e).slice(0, 200), false);
    await pool.query('update platform_accounts set last_error=$3 where user_id=$1 and platform=$2', [userId, platform, String(e?.message ?? e).slice(0, 200)]);
    rep.message = `Synchronisation failed: ${e?.message ?? e}`;
    return rep;
  }

  // Platforms that publish no totals (Codeforces) derive them from the complete history just read.
  // An empty history never produces a total, so a failed or partial read cannot zero the score.
  const inContestIds = new Set(submissions.filter((s) => s.inContest && s.contestExternalId).map((s) => s.contestExternalId!));
  if (!totals && submissions.length > 0) {
    const solved = new Set(submissions.filter((s) => s.accepted).map((s) => s.externalProblemId));
    const attended = new Set([...history.map((h) => h.contestExternalId), ...inContestIds]);
    totals = { problems: solved.size, contests: attended.size, rating: profile.rating };
  }

  await tx(async (c) => {
    // Only the contests this user's history refers to; the global listing is maintained by discoverContests.
    const needed = new Set<string>([...inContestIds, ...history.map((h) => h.contestExternalId)]);
    const cidByExt = new Map<string, string>();
    for (const k of contests) {
      if (!needed.has(k.externalContestId)) continue;
      const { id } = await upsertContest(c, null, { ...k, source: `${platform}-api` });
      cidByExt.set(k.externalContestId, id);
    }
    const contestId = async (ext: string): Promise<string | null> => cidByExt.get(ext) ?? (await c.query(
      'select id from contests where platform=$1 and external_contest_id=$2', [platform, ext])).rows[0]?.id ?? null;

    for (const s of submissions) {
      if (!s.accepted) continue;
      const { isNew } = await ingestAccepted(c, userId, {
        platform, externalSubmissionId: s.externalSubmissionId, externalProblemId: s.externalProblemId,
        acceptedAt: s.submittedAt, contestExternalId: s.contestExternalId, source: 'SYNC',
        title: s.title, url: s.url, difficulty: s.difficulty,
      });
      if (isNew) rep.newProblems++;
    }
    // In-contest submissions prove participation before the rating update lands.
    for (const ext of inContestIds) {
      const id = await contestId(ext);
      if (id && (await recordParticipation(c, userId, platform, id, { source: 'SYNC' })).isNew) rep.newParticipations++;
    }
    for (const h of history) {
      const id = await contestId(h.contestExternalId);
      if (id && (await recordParticipation(c, userId, platform, id, { ratingBefore: h.oldRating, ratingAfter: h.newRating, source: 'SYNC' })).isNew) rep.newParticipations++;
      await recordRating(c, userId, platform, h.newRating, h.at, h.contestExternalId);
    }
    if (history.length === 0 && (totals?.rating ?? profile.rating) != null) {
      await recordRating(c, userId, platform, (totals?.rating ?? profile.rating)!, new Date(now), null);
    }
    if (totals) {
      // Never baseline earlier than the newest submission read, so clock skew cannot count one problem twice.
      const at = Math.max(now, ...submissions.map((x) => x.submittedAt.getTime()), ...history.map((h) => h.at.getTime()));
      await rebaseline(c, userId, platform, totals, new Date(at));
    }
    await c.query('update platform_accounts set last_synced_at=$3, verified_at=$3, last_error=null, updated_at=now() where user_id=$1 and platform=$2',
      [userId, platform, new Date(now)]);
    await setStatus(c, userId, platform, adapter.sourceState, null, true);
    await recordEvent(c, userId, 'PLATFORM_SYNCED', platform, null, { newProblems: rep.newProblems, newParticipations: rep.newParticipations, totals });
    await refreshAfterChange(c, userId, now, `sync:${platform}`);
  });
  rep.ok = true;
  rep.message = 'SYNCED';
  return rep;
}

// ---------- global contest discovery ----------

export interface ContestSource {
  key: string;                     // source_health key suffix and contests.source value
  platform: Platform;
  /** null: no permissible public source exists; the reason is shown instead of an empty list */
  fetch: (() => Promise<NormalizedContest[]>) | null;
  reason?: string;
  /** true when the source lists every upcoming contest, so a missing one can be treated as cancelled */
  complete?: boolean;
}

/** Official or first-party sources first; an aggregator only as an optional fallback; otherwise stated as unavailable. */
export function contestSources(): ContestSource[] {
  return [
    { key: 'codeforces', platform: 'codeforces', fetch: () => ADAPTERS.codeforces.getContests!(), complete: true },
    config.sources.leetcode
      ? { key: 'leetcode', platform: 'leetcode', fetch: fetchLeetCodeContests }
      : { key: 'leetcode', platform: 'leetcode', fetch: null, reason: 'Switched off on this server.' },
    config.sources.codechefContests
      ? { key: 'codechef', platform: 'codechef', fetch: fetchCodeChefContests, complete: true }
      : { key: 'codechef', platform: 'codechef', fetch: null, reason: 'Switched off on this server.' },
    clistConfigured()
      ? { key: 'hackerrank', platform: 'hackerrank', fetch: async () => (await fetchClistContests()).filter((c) => c.platform === 'hackerrank') }
      : { key: 'hackerrank', platform: 'hackerrank', fetch: null, reason: 'HackerRank does not permit automated reading of its contest listing.' },
    { key: 'smartinterviews', platform: 'smartinterviews', fetch: null, reason: 'Smart Interviews publishes no readable contest listing.' },
    { key: 'interviewbit', platform: 'interviewbit', fetch: null, reason: 'InterviewBit runs no public contest series.' },
  ];
}

const DAY = 86_400_000;

/**
 * One global job for everyone. Each source is independent: a failure keeps that source's last verified contests
 * (nothing is deleted) and marks the source STALE (or ERROR after a day without success); the others carry on.
 * Contests are keyed by (platform, external id), so repeated runs update rather than duplicate.
 */
export async function discoverContests(_userId: string | null, now = Date.now(), sources = contestSources()): Promise<{ found: number; sources: string[]; errors: string[] }> {
  const ok: string[] = [];
  const errors: string[] = [];
  let found = 0;
  for (const s of sources) {
    const key = `contests:${s.key}`;
    if (!s.fetch) {
      await pool.query(`insert into source_health(key, status, checked_at, message) values ($1,'UNAVAILABLE',$2,$3)
        on conflict (key) do update set status='UNAVAILABLE', checked_at=excluded.checked_at, message=excluded.message`, [key, new Date(now), s.reason ?? null]);
      continue;
    }
    try {
      const all = await s.fetch();
      const list = all.filter((c) => c.endAt.getTime() > now - DAY);
      await tx(async (c) => {
        for (const k of list) if ((await upsertContest(c, null, { ...k, source: s.key })).isNew) found++;
        // A successful, non-empty, complete listing is authoritative for this platform's upcoming contests: one that
        // was listed before and has vanished before starting has been cancelled or replaced. An empty, failed or
        // partial listing (LeetCode publishes only the next two) cancels nothing, and a contest listed again is
        // restored by the upsert above.
        if (s.complete && all.length > 0) {
          await c.query(
            `update contests set cancelled_at = $3
              where platform = $1 and start_at > $3 and cancelled_at is null and coalesce(source, '') <> 'file'
                and not (external_contest_id = any($2::text[]))`,
            [s.platform, all.map((k) => String(k.externalContestId)), new Date(now)]);
        }
      });
      await pool.query(`insert into source_health(key, status, last_ok_at, checked_at, message) values ($1,'SYNCED',$2,$2,$3)
        on conflict (key) do update set status='SYNCED', last_ok_at=excluded.last_ok_at, checked_at=excluded.checked_at, message=excluded.message`,
        [key, new Date(now), `${list.length} current or upcoming`]);
      ok.push(s.key);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 200);
      errors.push(`${s.key}: ${msg}`);
      await pool.query(`insert into source_health(key, status, checked_at, message) values ($1,'ERROR',$2,$3)
        on conflict (key) do update set checked_at=excluded.checked_at, message=excluded.message,
          status = case when source_health.last_ok_at > $2::timestamptz - interval '1 day' then 'STALE' else 'ERROR' end`,
        [key, new Date(now), msg]);
    }
  }
  // Contests added by hand on the server (contests.json), if present.
  const local = join(process.cwd(), 'contests.json');
  const localPath = existsSync(local) ? local : join(process.cwd(), 'server', 'contests.json');
  if (existsSync(localPath)) {
    try {
      const rows = JSON.parse(readFileSync(localPath, 'utf8')) as any[];
      await tx(async (c) => {
        for (const r of rows) if ((await upsertContest(c, null, {
          platform: r.platform, externalContestId: String(r.id), title: String(r.title), startAt: new Date(r.start), endAt: new Date(r.end),
          registrationUrl: r.registrationUrl ?? null, contestUrl: r.contestUrl ?? null, rated: r.rated ?? true, source: 'file',
        })).isNew) found++;
      });
      ok.push('contests.json');
    } catch (e: any) { errors.push(`contests.json: ${e?.message ?? e}`); }
  }
  return { found, sources: ok, errors };
}

export async function sourceHealth(db: Db): Promise<{ platform: string; status: string; lastOkAt: string | null; checkedAt: string; message: string | null }[]> {
  return (await db.query(`select * from source_health where key like 'contests:%' order by key`)).rows.map((r) => ({
    platform: (r.key as string).slice('contests:'.length), status: r.status, lastOkAt: r.last_ok_at ? r.last_ok_at.toISOString() : null,
    checkedAt: r.checked_at.toISOString(), message: r.message,
  }));
}
