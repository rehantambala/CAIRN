import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pool, tx } from '../db/pool.js';
import type { Db } from '../db/pool.js';
import { ADAPTERS } from '../adapters/index.js';
import { clistConfigured, fetchClistContests } from '../adapters/clist.js';
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
  const acct = (await pool.query('select username from platform_accounts where user_id=$1 and platform=$2', [userId, platform])).rows[0];
  if (!acct?.username) { rep.message = 'Not connected. Enter your handle in Settings.'; return rep; }
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
    const cidByExt = new Map<string, string>();
    for (const k of contests) {
      const { id } = await upsertContest(c, userId, k);
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
    await c.query('update platform_accounts set last_synced_at=$3, connection_status=$4, updated_at=now() where user_id=$1 and platform=$2',
      [userId, platform, new Date(now), 'CONNECTED']);
    await setStatus(c, userId, platform, adapter.sourceState, null, true);
    await recordEvent(c, userId, 'PLATFORM_SYNCED', platform, null, { newProblems: rep.newProblems, newParticipations: rep.newParticipations, totals });
    await refreshAfterChange(c, userId, now, `sync:${platform}`);
  });
  rep.ok = true;
  rep.message = 'SYNCED';
  return rep;
}

/** Contest discovery. Codeforces via the official API, others via clist (if keyed) and the local contests.json. */
export async function discoverContests(userId: string | null, now = Date.now()): Promise<{ found: number; sources: string[]; errors: string[] }> {
  const all: NormalizedContest[] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  try {
    const cs = await ADAPTERS.codeforces.getContests!();
    all.push(...cs.filter((c) => c.endAt.getTime() > now - 86_400_000));
    sources.push('codeforces');
  } catch (e: any) { errors.push(`codeforces: ${e?.message ?? e}`); }
  if (clistConfigured()) {
    try { all.push(...(await fetchClistContests(now))); sources.push('clist'); }
    catch (e: any) { errors.push(`clist: ${e?.message ?? e}`); }
  }
  const local = join(process.cwd(), 'contests.json');
  const localPath = existsSync(local) ? local : join(process.cwd(), 'server', 'contests.json');
  if (existsSync(localPath)) {
    try {
      const rows = JSON.parse(readFileSync(localPath, 'utf8')) as any[];
      for (const r of rows) all.push({
        platform: r.platform, externalContestId: String(r.id), title: String(r.title),
        startAt: new Date(r.start), endAt: new Date(r.end), registrationUrl: r.registrationUrl ?? null,
        contestUrl: r.contestUrl ?? null, rated: r.rated ?? true, phase: 'UPCOMING',
      });
      sources.push('contests.json');
    } catch (e: any) { errors.push(`contests.json: ${e?.message ?? e}`); }
  }
  let found = 0;
  await tx(async (c) => {
    for (const k of all) { if ((await upsertContest(c, userId, k)).isNew) found++; }
  });
  return { found, sources, errors };
}
