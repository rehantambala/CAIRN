import type { Db } from '../db/pool.js';
import { tx } from '../db/pool.js';
import { dayKey } from '../domain/time.js';
import type { Platform } from '../domain/types.js';
import { evaluateAwards, refreshObjective, ensureObjective, snapshotIfChanged } from './derived.js';
import { computeToday } from './today.js';
import { getUser, recordEvent } from './state.js';
import { scheduleObjectiveComplete } from './notify.js';

export interface AcceptedInput {
  platform: Platform;
  externalSubmissionId?: string | null;
  externalProblemId: string;
  acceptedAt: Date;
  contestExternalId?: string | null;
  source: 'SYNC' | 'IMPORT' | 'MANUAL';
  title?: string;
  url?: string;
  difficulty?: string | null;
}

/**
 * Steps 1-3 of the accepted-problem pipeline: record the submission, deduplicate, and
 * create the solved-problem row if new. Re-running with the same input changes nothing.
 * Derived state is refreshed separately (refreshAfterChange) so batches refresh once.
 */
export async function ingestAccepted(db: Db, userId: string, a: AcceptedInput): Promise<{ isNew: boolean }> {
  if (a.title && a.url) {
    await db.query(
      `insert into problems(platform, external_problem_id, title, url, difficulty)
       values ($1,$2,$3,$4,$5) on conflict (platform, external_problem_id) do nothing`,
      [a.platform, a.externalProblemId, a.title, a.url, a.difficulty ?? null],
    );
  }
  let submissionId: string | null = null;
  if (a.externalSubmissionId) {
    const s = await db.query(
      `insert into submissions(user_id, platform, external_submission_id, external_problem_id, verdict, submitted_at, accepted_at, contest_id)
       values ($1,$2,$3,$4,'ACCEPTED',$5,$5,$6)
       on conflict (user_id, platform, external_submission_id) where external_submission_id is not null
       do update set verdict = 'ACCEPTED' returning id`,
      [userId, a.platform, a.externalSubmissionId, a.externalProblemId, a.acceptedAt, a.contestExternalId ?? null],
    );
    submissionId = s.rows[0].id;
  }
  const r = await db.query(
    `insert into solved_problems(user_id, platform, external_problem_id, first_accepted_at, source_submission_id, source)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (user_id, platform, external_problem_id) do update set
       first_accepted_at = least(solved_problems.first_accepted_at, excluded.first_accepted_at),
       source = case when excluded.source <> 'MANUAL' then excluded.source else solved_problems.source end,
       source_submission_id = coalesce(solved_problems.source_submission_id, excluded.source_submission_id)
     returning (xmax = 0) as inserted`,
    [userId, a.platform, a.externalProblemId, a.acceptedAt, submissionId, a.source],
  );
  const isNew = r.rows[0].inserted as boolean;
  if (isNew) {
    await recordEvent(db, userId, 'PROBLEM_ACCEPTED', a.platform, a.externalProblemId, { source: a.source, at: a.acceptedAt });
  }
  return { isNew };
}

export interface RefreshResult {
  overall: number;
  scoreDelta: number;
  justCompleted: boolean;
  newAwards: string[];
  nextChanged: boolean;
}

/**
 * Steps 4-11: platform stat (derived on read), recalc, snapshot, today's objective,
 * calendar, awards, and whether NEXT changed. Idempotent.
 */
export async function refreshAfterChange(db: Db, userId: string, now: number, reason: string, nextBefore?: string): Promise<RefreshResult> {
  const user = await getUser(db, userId);
  const date = dayKey(now, user.timezone);
  const snap = await snapshotIfChanged(db, userId, new Date(now), reason);
  await ensureObjective(db, userId, now);
  const { justCompleted } = await refreshObjective(db, userId, date, now);
  const awards = await evaluateAwards(db, userId, new Date(now));
  if (justCompleted) await scheduleObjectiveComplete(db, userId, date, now);
  // Awards can depend on the day just completed; evaluate again only when it changed.
  const after = await computeToday(db, userId, now);
  const nextKey = JSON.stringify([after.next.kind, after.next.title, after.next.detail]);
  return {
    overall: snap.overall, scoreDelta: snap.delta, justCompleted, newAwards: awards,
    nextChanged: nextBefore !== undefined && nextBefore !== nextKey,
  };
}

export async function nextKey(db: Db, userId: string, now: number): Promise<string> {
  const t = await computeToday(db, userId, now);
  return JSON.stringify([t.next.kind, t.next.title, t.next.detail]);
}

/** Convenience: one accepted submission end to end, in one transaction. */
export async function processAccepted(userId: string, a: AcceptedInput, now = Date.now()) {
  return tx(async (c) => {
    const before = await nextKey(c, userId, now);
    const { isNew } = await ingestAccepted(c, userId, a);
    const refresh = await refreshAfterChange(c, userId, now, `accepted:${a.platform}`, before);
    return { isNew, ...refresh };
  });
}
