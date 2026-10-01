import type { Db } from '../db/pool.js';
import { AWARD_DEFINITIONS, newAwards, type AwardMetrics } from '../domain/awards.js';
import { dayState } from '../domain/calendar.js';
import { computeConsistency, type ContestRecord, type DayRecord } from '../domain/consistency.js';
import { generateObjective, selectProblems, solvedKey, suggestionGuidance, type ContestCandidate, type Objective, type ObjectiveState, type PoolProblem } from '../domain/objective.js';
import { computeScore } from '../domain/score.js';
import { addDays, dayEnd, dayKey, dayStart, hourMinute } from '../domain/time.js';
import { computeTrajectory, type Snapshot } from '../domain/trajectory.js';
import type { Platform, Verification } from '../domain/types.js';
import { getUser, loadScore, loadStats, recordEvent, toScoreInputs } from './state.js';

// ---------- snapshots ----------

export async function loadSnapshots(db: Db, userId: string): Promise<Snapshot[]> {
  const { rows } = await db.query(
    'select captured_at, overall_score from score_snapshots where user_id = $1 order by captured_at', [userId],
  );
  return rows.map((r) => ({ at: (r.captured_at as Date).getTime(), score: r.overall_score as number }));
}

/** Writes a snapshot only when the score changed (or none exists). Returns the change. */
export async function snapshotIfChanged(db: Db, userId: string, now: Date, reason: string) {
  const { score } = await loadScore(db, userId);
  const last = (await db.query(
    'select overall_score from score_snapshots where user_id=$1 order by captured_at desc limit 1', [userId],
  )).rows[0];
  if (last && last.overall_score === score.overall) return { changed: false, overall: score.overall, delta: 0 };
  await db.query(
    `insert into score_snapshots(user_id, overall_score, leetcode_score, codechef_score, codeforces_score,
       smart_interviews_score, interviewbit_score, hackerrank_score, captured_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [userId, score.overall, score.leetcode.total, score.codechef.total, score.codeforces.total,
      score.smartinterviews, score.interviewbit, score.hackerrank, now],
  );
  const delta = last ? score.overall - last.overall_score : 0;
  if (last) await recordEvent(db, userId, 'SCORE_CHANGED', null, null, { from: last.overall_score, to: score.overall, delta, reason });
  return { changed: true, overall: score.overall, delta };
}

// ---------- pool / contests ----------

export async function loadPool(db: Db): Promise<PoolProblem[]> {
  const { rows } = await db.query('select platform, external_problem_id, title, url, difficulty, topic from problems');
  return rows.map((r) => ({
    platform: r.platform, externalId: r.external_problem_id, title: r.title, url: r.url,
    difficulty: r.difficulty, topic: r.topic,
  }));
}

export async function loadSolvedSet(db: Db, userId: string): Promise<Set<string>> {
  const { rows } = await db.query('select platform, external_problem_id from solved_problems where user_id=$1', [userId]);
  return new Set(rows.map((r) => solvedKey(r.platform, r.external_problem_id)));
}

export async function loadContestCandidates(db: Db, userId: string, now: number): Promise<ContestCandidate[]> {
  const { rows } = await db.query(
    `select c.*, (cc.id is not null) as committed
       from contests c
       left join contest_commitments cc on cc.contest_id = c.id and cc.user_id = $1
      where c.end_at > $2 order by c.start_at`,
    [userId, new Date(now)],
  );
  return rows.map((r) => ({
    id: r.id, platform: r.platform, title: r.title, startAt: (r.start_at as Date).getTime(),
    endAt: (r.end_at as Date).getTime(), rated: r.rated, committed: r.committed,
    registrationUrl: r.registration_url, contestUrl: r.contest_url,
  }));
}

// ---------- calendar / consistency ----------

export interface ObjectiveRow {
  id: string; date: string; status: string; isRest: boolean; trajectoryStatus: string;
  targetScoreDelta: number; rationale: string[]; scoreAtStart: number | null; scoreAtClose: number | null;
  completedAt: Date | null;
  items: ItemRow[];
}
export interface ItemRow {
  id: string; position: number; type: string; platform: Platform | null; contestId: string | null;
  title: string; reason: string; required: boolean; quota: number; completedCount: number;
  completed: boolean; completedAt: Date | null; verification: Verification;
  suggestions: PoolProblem[]; practiceUrl: string | null; guidance: string | null; minutes: number; points: number;
}

function mapItem(r: any): ItemRow {
  const sj = r.suggestions_json ?? {};
  return {
    id: r.id, position: r.position, type: r.type, platform: r.platform, contestId: r.contest_id,
    title: r.title, reason: r.reason, required: r.required, quota: r.quota, completedCount: r.completed_count,
    completed: r.completed, completedAt: r.completed_at, verification: r.verification,
    suggestions: Array.isArray(sj) ? sj : (sj.problems ?? []), practiceUrl: Array.isArray(sj) ? null : (sj.practiceUrl ?? null),
    guidance: Array.isArray(sj) ? null : (sj.guidance ?? null), minutes: r.minutes, points: r.points,
  };
}

export async function loadObjectives(db: Db, userId: string, from: string, to: string): Promise<ObjectiveRow[]> {
  const objs = (await db.query(
    'select * from daily_objectives where user_id=$1 and date between $2 and $3 order by date', [userId, from, to],
  )).rows;
  if (objs.length === 0) return [];
  const items = (await db.query(
    'select * from daily_objective_items where objective_id = any($1::uuid[]) order by position', [objs.map((o) => o.id)],
  )).rows;
  return objs.map((o) => ({
    id: o.id, date: o.date, status: o.status, isRest: o.is_rest, trajectoryStatus: o.trajectory_status,
    targetScoreDelta: o.target_score_delta, rationale: o.rationale_json, scoreAtStart: o.score_at_start,
    scoreAtClose: o.score_at_close, completedAt: o.completed_at,
    items: items.filter((i) => i.objective_id === o.id).map(mapItem),
  }));
}

export async function dayRecords(db: Db, userId: string, from: string, to: string, today: string): Promise<DayRecord[]> {
  const objs = await loadObjectives(db, userId, from, to);
  return objs.map((o) => {
    const r = dayState({
      isRest: o.isRest, isToday: o.date === today,
      items: o.items.map((i) => ({ required: i.required, completed: i.completed, verification: i.verification })),
    });
    return { date: o.date, state: r.state, requiredTotal: r.requiredTotal, requiredDone: r.requiredDone };
  });
}

export async function consistencyFor(db: Db, userId: string, now: number, tz: string) {
  const today = dayKey(now, tz);
  const days = await dayRecords(db, userId, addDays(today, -120), today, today);
  const { rows } = await db.query(
    `select c.start_at, (cp.id is not null and cp.participated) as attended
       from contest_commitments cm
       join contests c on c.id = cm.contest_id
       left join contest_participations cp on cp.contest_id = c.id and cp.user_id = cm.user_id
      where cm.user_id = $1 and c.end_at < $2`, [userId, new Date(now)],
  );
  const contests: ContestRecord[] = rows.map((r) => {
    const hm = hourMinute((r.start_at as Date).getTime(), tz).split(':').map(Number);
    return { committed: true, attended: r.attended, startHourLocal: hm[0], startMinuteLocal: hm[1] };
  });
  return { consistency: computeConsistency(days, contests, today), days };
}

// ---------- objective lifecycle ----------

export async function ensureObjective(db: Db, userId: string, now: number): Promise<ObjectiveRow> {
  const user = await getUser(db, userId);
  const date = dayKey(now, user.timezone);
  const existing = await loadObjectives(db, userId, date, date);
  if (existing[0]) return existing[0];

  const { inputs, score } = await loadScore(db, userId);
  const snapshots = await loadSnapshots(db, userId);
  const trajectory = computeTrajectory({ snapshots, now, target: user.targetScore, targetDate: user.targetDate, tz: user.timezone });
  const { consistency } = await consistencyFor(db, userId, now, user.timezone);
  const state: ObjectiveState = {
    now, tz: user.timezone, date, scoreInputs: inputs, trajectory,
    executionRate: consistency.executionRate, consecutiveComplete: consistency.consecutiveComplete,
    contests: await loadContestCandidates(db, userId, now),
    solved: await loadSolvedSet(db, userId), pool: await loadPool(db), baseMinutes: user.dailyMinutes,
  };
  const obj: Objective = generateObjective(state);

  const ins = await db.query(
    `insert into daily_objectives(user_id, date, target_score_delta, status, trajectory_status, is_rest, rationale_json, score_at_start)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (user_id, date) do nothing returning id`,
    [userId, date, obj.targetScoreDelta, obj.isRest ? 'REST' : 'ACTIVE', trajectory.status, obj.isRest,
      JSON.stringify(obj.rationale), score.overall],
  );
  if (ins.rows[0]) {
    const id = ins.rows[0].id as string;
    let pos = 0;
    for (const it of obj.items) {
      await db.query(
        `insert into daily_objective_items(objective_id, position, type, platform, contest_id, title, reason, required,
           quota, minutes, points, suggestions_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, pos++, it.type, it.platform, it.contestId, it.title, it.reason, it.required, it.quota, it.minutes, it.points,
          JSON.stringify({ problems: it.suggestions, practiceUrl: it.practiceUrl, guidance: it.guidance })],
      );
    }
    await recordEvent(db, userId, 'DAILY_OBJECTIVE_CREATED', null, date, { items: obj.items.length, rest: obj.isRest });
  }
  return (await loadObjectives(db, userId, date, date))[0];
}

/**
 * Suggestions are a view of the pool, not a promise made at midnight. They are recomputed for every open
 * quota item so that a pool that grew, or a problem solved elsewhere, is always reflected, and a list can
 * never remain empty merely because it was generated early.
 */
export async function refreshSuggestions(db: Db, userId: string, obj: ObjectiveRow) {
  const open = obj.items.filter((i) => i.type === 'PROBLEM_QUOTA' && i.platform && !i.completed);
  if (open.length === 0) return;
  const [pool, solved, stats] = [await loadPool(db), await loadSolvedSet(db, userId), (await loadScore(db, userId)).inputs];
  for (const it of open) {
    const p = it.platform as 'leetcode' | 'codechef' | 'codeforces';
    if (!(p in stats)) continue;
    const rating = stats[p].rating;
    const next = selectProblems(pool, solved, p, rating, it.quota + 2, obj.date);
    const same = next.length === it.suggestions.length && next.every((n, k) => n.externalId === it.suggestions[k].externalId);
    if (same) continue;
    await db.query(
      'update daily_objective_items set suggestions_json=$2 where id=$1',
      [it.id, JSON.stringify({ problems: next, practiceUrl: it.practiceUrl, guidance: suggestionGuidance(next.length, it.quota, rating) })],
    );
  }
}

/**
 * Recompute item completion for a day from verified data. Idempotent and derived:
 * quota items count solved problems first accepted within the local day; contest items
 * look for a participation. Returns true when the day just became COMPLETE.
 */
export async function refreshObjective(db: Db, userId: string, date: string, now: number): Promise<{ justCompleted: boolean }> {
  const user = await getUser(db, userId);
  const obj = (await loadObjectives(db, userId, date, date))[0];
  if (!obj) return { justCompleted: false };
  const from = new Date(dayStart(date, user.timezone)), to = new Date(dayEnd(date, user.timezone));
  if (obj.status === 'ACTIVE') await refreshSuggestions(db, userId, obj);

  for (const it of obj.items) {
    if (it.type === 'PROBLEM_QUOTA' && it.platform) {
      const { rows } = await db.query(
        `select count(*)::int as n, count(*) filter (where source = 'MANUAL')::int as manual
           from solved_problems where user_id=$1 and platform=$2 and first_accepted_at >= $3 and first_accepted_at < $4`,
        [userId, it.platform, from, to],
      );
      const n: number = rows[0].n, manual: number = rows[0].manual;
      const completed = n >= it.quota;
      const verification: Verification = n === 0 ? 'PENDING' : manual > 0 ? 'MANUAL' : 'VERIFIED';
      await db.query(
        `update daily_objective_items set completed_count=$2, completed=$3, verification=$4,
           completed_at = case when $3 and completed_at is null then $5 else completed_at end where id=$1`,
        [it.id, Math.min(n, it.quota), completed, verification, new Date(now)],
      );
    } else if (it.type === 'CONTEST' && it.contestId) {
      const { rows } = await db.query(
        'select source from contest_participations where user_id=$1 and contest_id=$2 and participated', [userId, it.contestId],
      );
      const hit = rows[0];
      await db.query(
        `update daily_objective_items set completed_count=$2, completed=$3, verification=$4,
           completed_at = case when $3 and completed_at is null then $5 else completed_at end where id=$1`,
        [it.id, hit ? 1 : 0, !!hit, hit ? (hit.source === 'MANUAL' ? 'MANUAL' : 'VERIFIED') : 'PENDING', new Date(now)],
      );
    }
  }

  const fresh = (await loadObjectives(db, userId, date, date))[0];
  const today = dayKey(now, user.timezone);
  const r = dayState({
    isRest: fresh.isRest, isToday: date === today,
    items: fresh.items.map((i) => ({ required: i.required, completed: i.completed, verification: i.verification })),
  });
  const wasComplete = obj.status === 'COMPLETE';
  const { overall } = (await loadScore(db, userId)).score;
  if (r.state === 'COMPLETE' && !wasComplete) {
    await db.query(
      `update daily_objectives set status='COMPLETE', completed_at=$2, score_at_close=$3 where id=$1`,
      [fresh.id, new Date(now), overall],
    );
    await recordEvent(db, userId, 'DAILY_OBJECTIVE_COMPLETED', null, date, { verified: r.verified });
    return { justCompleted: true };
  }
  if (r.state !== 'COMPLETE' && wasComplete) {
    await db.query(`update daily_objectives set status=$2, completed_at=null where id=$1`, [fresh.id, r.state]);
  }
  return { justCompleted: false };
}

/** Closes every open past day. Idempotent; safe to run late. */
export async function closePastDays(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const today = dayKey(now, user.timezone);
  const open = (await db.query(
    `select date from daily_objectives where user_id=$1 and date < $2 and status = 'ACTIVE' order by date`, [userId, today],
  )).rows;
  for (const row of open) {
    await refreshObjective(db, userId, row.date, now);
    const o = (await loadObjectives(db, userId, row.date, row.date))[0];
    const r = dayState({
      isRest: o.isRest, isToday: false,
      items: o.items.map((i) => ({ required: i.required, completed: i.completed, verification: i.verification })),
    });
    const { overall } = (await loadScore(db, userId)).score;
    await db.query(`update daily_objectives set status=$2, score_at_close=coalesce(score_at_close,$3) where id=$1`, [o.id, r.state, overall]);
    if (r.state === 'MISSED' || r.state === 'PARTIAL') {
      await recordEvent(db, userId, 'DAILY_OBJECTIVE_MISSED', null, row.date, { state: r.state, done: r.requiredDone, total: r.requiredTotal });
    }
  }
  return open.length;
}

// ---------- awards ----------

export async function awardMetrics(db: Db, userId: string): Promise<AwardMetrics> {
  const { stats, score } = await loadScore(db, userId);
  const g = (p: Platform) => stats.find((s) => s.platform === p)!;
  const verifiedDays = (await db.query(
    `select count(*)::int as n from daily_objectives where user_id=$1 and status='COMPLETE' and not is_rest`, [userId],
  )).rows[0].n as number;
  const rated = stats.filter((s) => ['leetcode', 'codechef', 'codeforces'].includes(s.platform)).reduce((a, s) => a + s.contests, 0);
  return {
    verifiedDays, ratedContests: rated,
    problems: { leetcode: g('leetcode').problems, codechef: g('codechef').problems, codeforces: g('codeforces').problems },
    ratings: { leetcode: g('leetcode').rating ?? 0, codechef: g('codechef').rating ?? 0, codeforces: g('codeforces').rating ?? 0 },
    overall: score.overall,
  };
}

export async function evaluateAwards(db: Db, userId: string, now: Date): Promise<string[]> {
  const held = (await db.query('select award_type from awards where user_id=$1', [userId])).rows.map((r) => r.award_type);
  const metrics = await awardMetrics(db, userId);
  const fresh = newAwards(metrics, held);
  for (const key of fresh) {
    const ins = await db.query(
      'insert into awards(user_id, award_type, achieved_at, metadata_json) values ($1,$2,$3,$4) on conflict do nothing returning id',
      [userId, key, now, JSON.stringify(metrics)],
    );
    if (ins.rows[0]) await recordEvent(db, userId, 'AWARD_ACHIEVED', null, key, {});
  }
  return fresh;
}

export { AWARD_DEFINITIONS, toScoreInputs, loadStats, computeScore };

/** Committing to (or dropping) a contest today changes whether its item is required. */
export async function applyCommitmentToToday(db: Db, userId: string, contestId: string, committed: boolean, now: number) {
  const user = await getUser(db, userId);
  const date = dayKey(now, user.timezone);
  const obj = (await loadObjectives(db, userId, date, date))[0];
  if (!obj || obj.isRest) return;
  const c = (await db.query('select * from contests where id=$1', [contestId])).rows[0];
  if (!c || !c.rated) return;
  const start = (c.start_at as Date).getTime();
  const s = dayStart(date, user.timezone), e = dayEnd(date, user.timezone);
  if (start < s || start >= e) return;
  const perContest = 50;
  const existing = obj.items.find((i) => i.type === 'CONTEST' && i.contestId === contestId);
  const prep = obj.items.find((i) => i.type === 'CONTEST_PREP' && i.contestId === contestId);
  if (committed) {
    if (existing) {
      await db.query(`update daily_objective_items set required=true, reason=$2 where id=$1`,
        [existing.id, `Committed. Participation adds ${perContest} points deterministically; rating outcome is uncertain.`]);
    } else {
      const pos = obj.items.length;
      await db.query(
        `insert into daily_objective_items(objective_id, position, type, platform, contest_id, title, reason, required, quota, minutes, points, suggestions_json)
         values ($1,$2,'CONTEST',$3,$4,$5,$6,true,1,$7,$8,'{}')`,
        [obj.id, pos, c.platform, contestId, `${c.platform} ${c.title}`,
          `Committed. Participation adds ${perContest} points deterministically; rating outcome is uncertain.`,
          Math.round(((c.end_at as Date).getTime() - start) / 60_000), perContest],
      );
    }
    if (!prep) {
      await db.query(
        `insert into daily_objective_items(objective_id, position, type, platform, contest_id, title, reason, required, quota, minutes, points, suggestions_json)
         values ($1,$2,'CONTEST_PREP',$3,$4,'Contest preparation',$5,false,1,30,0,'{}')`,
        [obj.id, obj.items.length + 1, c.platform, contestId, `Preparation block before ${c.title}, starting ${hourMinute(start - 30 * 60_000, user.timezone)}.`],
      );
    }
  } else {
    if (existing) await db.query(`update daily_objective_items set required=false where id=$1`, [existing.id]);
    if (prep) await db.query('delete from daily_objective_items where id=$1', [prep.id]);
  }
  await refreshObjective(db, userId, date, now);
}
