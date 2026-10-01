import type { Db } from '../db/pool.js';
import { AWARD_DEFINITIONS } from '../domain/awards.js';
import { dailySeries, milestonesFor } from '../domain/trajectory.js';
import { marginal, reachability, computeScore, remaining, scenarioRatings, type ScoreInputs } from '../domain/score.js';
import { addDays, dayKey, dayStart } from '../domain/time.js';
import { PLATFORM_LABEL, RATED_PLATFORMS, type Platform } from '../domain/types.js';
import { ADAPTERS } from '../adapters/index.js';
import { capabilitiesOf } from '../adapters/types.js';
import { awardMetrics, consistencyFor, loadContestCandidates, loadPool, loadSnapshots, loadSolvedSet } from './derived.js';
import { buildBrief, contestPlan } from '../domain/brief.js';
import { contestState } from './contests.js';
import { sourceHealth } from './sync.js';
import { computeToday, computeTrajectoryFor } from './today.js';
import { connectionOf, getUser, knownRated, loadScore } from './state.js';

export function describeEvent(e: { event_type: string; platform: string | null; payload_json: any; created_at: Date }): string | null {
  const p = e.payload_json ?? {};
  const plat = e.platform ? PLATFORM_LABEL[e.platform as Platform] : '';
  switch (e.event_type) {
    case 'PROBLEM_ACCEPTED': return `${plat}: a problem was accepted${p.source === 'MANUAL' ? ' (recorded by you)' : ''}.`;
    case 'CONTEST_PARTICIPATED': return `${plat}: contest participation was recorded.`;
    case 'RATING_CHANGED': return `${plat}: rating moved from ${p.from ?? '—'} to ${p.rating}.`;
    case 'SCORE_CHANGED': return `The score changed by ${p.delta >= 0 ? '+' : '−'}${Math.abs(p.delta)}, to ${Number(p.to).toLocaleString('en-US')}.`;
    case 'DAILY_OBJECTIVE_COMPLETED': return p.verified ? 'Today\'s objective was completed and verified.' : 'Today\'s objective was completed and recorded by you.';
    case 'DAILY_OBJECTIVE_MISSED': return `The objective closed ${p.state === 'PARTIAL' ? 'partly complete' : 'incomplete'}: ${p.done} of ${p.total} required items.`;
    case 'AWARD_ACHIEVED': return `Milestone reached: ${AWARD_DEFINITIONS.find((a) => a.key === e.platform || a.key === (e as any).source_id)?.label ?? 'a new milestone'}.`;
    case 'PLATFORM_SYNCED': return p.seed ? null : `${plat} was synchronised.`;
    default: return null;
  }
}

export async function recentChanges(db: Db, userId: string, limit = 10) {
  const rows = (await db.query(
    `select event_type, platform, source_id, payload_json, created_at from activity_events
      where user_id=$1 and event_type in ('PROBLEM_ACCEPTED','CONTEST_PARTICIPATED','RATING_CHANGED','SCORE_CHANGED',
        'DAILY_OBJECTIVE_COMPLETED','DAILY_OBJECTIVE_MISSED','AWARD_ACHIEVED','PLATFORM_SYNCED')
      order by created_at desc limit 40`, [userId],
  )).rows;
  const out: { at: string; text: string; type: string }[] = [];
  for (const r of rows) {
    const text = r.event_type === 'AWARD_ACHIEVED'
      ? `Milestone reached: ${AWARD_DEFINITIONS.find((a) => a.key === r.source_id)?.label ?? 'a new milestone'}.`
      : describeEvent(r);
    if (text) out.push({ at: (r.created_at as Date).toISOString(), text, type: r.event_type });
    if (out.length >= limit) break;
  }
  return out;
}

export function sourcesView(stats: Awaited<ReturnType<typeof loadScore>>['stats']) {
  return stats.map((s) => ({
    platform: s.platform, label: PLATFORM_LABEL[s.platform], status: s.sourceStatus,
    updatedAt: s.lastUpdatedAt ? s.lastUpdatedAt.toISOString() : null, note: s.sourceNote,
    capability: ADAPTERS[s.platform].capability, capabilityNote: ADAPTERS[s.platform].capabilityNote,
    username: s.username || null,
    connection: connectionOf(s, ADAPTERS[s.platform].capability),
    capabilities: capabilitiesOf(ADAPTERS[s.platform]),
    verifiedAt: s.verifiedAt ? s.verifiedAt.toISOString() : null,
    lastError: s.lastError,
    hasFigures: s.known,
  }));
}

export function scoreView(loaded: Awaited<ReturnType<typeof loadScore>>) {
  const { stats, score, inputs } = loaded;
  const source = (p: Platform) => {
    const s = stats.find((x) => x.platform === p)!;
    return { status: s.sourceStatus, updatedAt: s.lastUpdatedAt ? s.lastUpdatedAt.toISOString() : null, note: s.sourceNote };
  };
  const rated = (p: (typeof RATED_PLATFORMS)[number]) => ({
    platform: p, label: PLATFORM_LABEL[p], total: score[p].total,
    problems: inputs[p].problems, rating: inputs[p].rating, contests: inputs[p].contests,
    parts: { problems: score[p].problemsPoints, rating: Math.floor(score[p].ratingPoints), contests: score[p].contestPoints },
    marginal: marginal(p, inputs[p].rating), source: source(p),
  });
  const manual = (p: 'smartinterviews' | 'interviewbit' | 'hackerrank') => ({
    platform: p, label: PLATFORM_LABEL[p], total: score[p], source: source(p),
  });
  return {
    overall: score.overall,
    components: [rated('leetcode'), rated('codechef'), rated('codeforces')],
    manual: [manual('smartinterviews'), manual('interviewbit'), manual('hackerrank')],
    inputs,
  };
}

export async function overview(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const loaded = await loadScore(db, userId);
  const { trajectory } = await computeTrajectoryFor(db, userId, now);
  const today = await computeToday(db, userId, now);
  const { consistency } = await consistencyFor(db, userId, now, user.timezone);
  const awards = (await db.query('select award_type, achieved_at from awards where user_id=$1 order by achieved_at desc', [userId])).rows;
  const contests = await loadContestCandidates(db, userId, now);
  const known = knownRated(loaded.stats);
  const reach = reachability(loaded.inputs, scenarioRatings(loaded.inputs, known), user.targetScore);
  const milestoneList = milestonesFor(user.targetScore);
  const next = milestoneList.find((m) => m > loaded.score.overall) ?? null;
  const brief = buildBrief({
    items: today.objective.items, scoreNow: loaded.score.overall, milestone: next, now,
    tz: user.timezone, date: today.objective.date, isRest: today.objective.isRest,
  });
  return {
    brief,
    user: { displayName: user.displayName, timezone: user.timezone, targetScore: user.targetScore, targetDate: user.targetDate },
    now: new Date(now).toISOString(),
    date: dayKey(now, user.timezone),
    score: scoreView(loaded),
    target: user.targetScore,
    remaining: remaining(loaded.score.overall, user.targetScore),
    trajectory,
    milestones: { list: milestoneList, current: loaded.score.overall, next },
    /** sources this user has: none means a new person who has not yet connected anything */
    knownSources: loaded.stats.filter((s) => s.known).map((s) => s.platform),
    next: today.next,
    today: today.objective,
    changes: await recentChanges(db, userId, 8),
    consistency,
    awards: awards.map((a) => a.award_type),
    sources: sourcesView(loaded.stats),
    upcomingContests: contests.slice(0, 3),
    reachability: reach,
  };
}

export async function contestsView(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const rows = (await db.query(
    `select c.*, (cm.id is not null) as committed, cm.prep_minutes,
            cp.id is not null and cp.participated as attended, cp.rating_delta, cp.rating_before, cp.rating_after
       from contests c
       left join contest_commitments cm on cm.contest_id = c.id and cm.user_id = $1
       left join contest_participations cp on cp.contest_id = c.id and cp.user_id = $1
      where c.cancelled_at is null and (c.end_at > $2 or (c.end_at > $3 and (cm.id is not null or cp.id is not null)))
      order by c.start_at`, [userId, new Date(now), new Date(now - 30 * 86_400_000)],
  )).rows;
  const linked = new Set((await db.query(`select platform from platform_accounts where user_id=$1 and username <> ''`, [userId])).rows.map((r) => r.platform as string));
  const loaded = await loadScore(db, userId);
  const [pool, solved, inputs] = [await loadPool(db), await loadSolvedSet(db, userId), loaded.inputs];
  const mine = new Set<string>(knownRated(loaded.stats));
  const date = dayKey(now, user.timezone);
  // This user's own reminder schedule, per contest (global contests are shared; reminders are not).
  const reminders = new Map<string, { type: string; at: string; status: string }[]>();
  for (const n of (await db.query(
    `select type, scheduled_for, status, payload_json->>'contestId' as cid from notifications
      where user_id=$1 and type in ('CONTEST_24H','CONTEST_1H','CONTEST_10M') and status in ('PENDING','DELIVERED') order by scheduled_for`, [userId],
  )).rows) {
    if (!reminders.has(n.cid)) reminders.set(n.cid, []);
    reminders.get(n.cid)!.push({ type: n.type, at: n.scheduled_for.toISOString(), status: n.status });
  }
  const view = rows.map((r) => {
    const startAt = (r.start_at as Date).getTime(), endAt = (r.end_at as Date).getTime();
    return {
      id: r.id, platform: r.platform as Platform, label: PLATFORM_LABEL[r.platform as Platform], title: r.title,
      startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(),
      registrationUrl: r.registration_url, contestUrl: r.contest_url, rated: r.rated,
      committed: r.committed, prepMinutes: r.prep_minutes ?? 30, attended: !!r.attended,
      ratingDelta: r.rating_delta, state: contestState({ startAt, endAt }, now, r.committed, !!r.attended),
      manualOk: ADAPTERS[r.platform as Platform].capability !== 'AUTOMATIC' || !linked.has(r.platform),
      source: r.source ?? null,
      lastVerifiedAt: r.last_verified_at ? r.last_verified_at.toISOString() : null,
      reminders: reminders.get(r.id) ?? [],
      plan: r.rated && endAt > now && mine.has(r.platform)
        ? contestPlan({
            platform: r.platform as Platform, startAt, prepMinutes: r.prep_minutes ?? 30, pool, solved, date,
            rating: (RATED_PLATFORMS as readonly string[]).includes(r.platform) ? inputs[r.platform as (typeof RATED_PLATFORMS)[number]].rating : null,
          })
        : null,
    };
  });
  return { timezone: user.timezone, now: new Date(now).toISOString(), contests: view, sources: await sourceHealth(db) };
}

export async function trajectoryView(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const { trajectory, score } = await computeTrajectoryFor(db, userId, now);
  const snaps = await loadSnapshots(db, userId);
  const series = dailySeries(snaps, dayKey(now, user.timezone), user.timezone);
  const loadedStats = await loadScore(db, userId);
  const stats = loadedStats.inputs;
  return {
    trajectory, series, target: user.targetScore, targetDate: user.targetDate,
    milestones: milestonesFor(user.targetScore).map((m) => ({ value: m, reached: score.overall >= m })),
    reachability: reachability(stats, scenarioRatings(stats, knownRated(loadedStats.stats)), user.targetScore),
  };
}

export function simulate(current: ScoreInputs, sim: ScoreInputs, target: number) {
  const cur = computeScore(current), res = computeScore(sim);
  // Effect of each changed variable in isolation, holding all others at current values.
  const effects: { key: string; label: string; from: number; to: number; effect: number }[] = [];
  const isolate = (mutate: (i: ScoreInputs) => void) => {
    const copy: ScoreInputs = JSON.parse(JSON.stringify(current));
    mutate(copy);
    return computeScore(copy).overall - cur.overall;
  };
  for (const p of RATED_PLATFORMS) {
    for (const f of ['problems', 'rating', 'contests'] as const) {
      if (sim[p][f] !== current[p][f]) {
        effects.push({
          key: `${p}.${f}`, label: `${PLATFORM_LABEL[p]} ${f}`, from: current[p][f], to: sim[p][f],
          effect: isolate((i) => { i[p][f] = sim[p][f]; }),
        });
      }
    }
  }
  for (const p of ['smartinterviews', 'interviewbit', 'hackerrank'] as const) {
    if (sim[p] !== current[p]) {
      effects.push({ key: p, label: PLATFORM_LABEL[p], from: current[p], to: sim[p], effect: sim[p] - current[p] });
    }
  }
  return {
    current: cur, simulated: res, delta: res.overall - cur.overall,
    remainingAfter: remaining(res.overall, target), target, effects,
    note: 'This is the arithmetic effect of the values entered. Contest rating outcomes are not predicted.',
  };
}

export async function calendarView(db: Db, userId: string, month: string, now: number) {
  const user = await getUser(db, userId);
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
  const rows = (await db.query(
    `select o.date, o.status, o.is_rest, o.target_score_delta, o.trajectory_status, o.score_at_start, o.score_at_close,
            count(i.*) filter (where i.required)::int as required_total,
            count(i.*) filter (where i.required and i.completed)::int as required_done,
            bool_and(i.verification = 'VERIFIED') filter (where i.required and i.completed) as verified
       from daily_objectives o left join daily_objective_items i on i.objective_id = o.id
      where o.user_id=$1 and o.date between $2 and $3 group by o.id order by o.date`, [userId, from, to],
  )).rows;
  return {
    month, today: dayKey(now, user.timezone), first: from, last: to,
    firstWeekday: new Date(`${from}T00:00:00Z`).getUTCDay(), // 0 = Sunday
    days: rows.map((r) => ({
      date: r.date, state: r.status, requiredTotal: r.required_total, requiredDone: r.required_done,
      verified: r.verified ?? false, scoreDelta: r.score_at_close != null && r.score_at_start != null ? r.score_at_close - r.score_at_start : null,
    })),
  };
}

export async function dayDetail(db: Db, userId: string, date: string, now: number) {
  const user = await getUser(db, userId);
  const { loadObjectives } = await import('./derived.js');
  const o = (await loadObjectives(db, userId, date, date))[0];
  if (!o) return { date, exists: false as const, today: dayKey(now, user.timezone) };
  const s = dayStart(date, user.timezone), e = dayStart(addDays(date, 1), user.timezone);
  const problems = (await db.query(
    `select sp.platform, sp.external_problem_id, sp.first_accepted_at, sp.source, p.title, p.url
       from solved_problems sp left join problems p on p.platform=sp.platform and p.external_problem_id=sp.external_problem_id
      where sp.user_id=$1 and sp.first_accepted_at >= $2 and sp.first_accepted_at < $3 order by sp.first_accepted_at`,
    [userId, new Date(s), new Date(e)],
  )).rows;
  const contests = (await db.query(
    `select c.title, c.platform, cp.rating_delta from contest_participations cp join contests c on c.id=cp.contest_id
      where cp.user_id=$1 and c.start_at >= $2 and c.start_at < $3`, [userId, new Date(s), new Date(e)],
  )).rows;
  const { dayState } = await import('../domain/calendar.js');
  const st = dayState({
    isRest: o.isRest, isToday: date === dayKey(now, user.timezone),
    items: o.items.map((i) => ({ required: i.required, completed: i.completed, verification: i.verification })),
  });
  return {
    date, exists: true as const, state: st.state, verified: st.verified, target: o.targetScoreDelta,
    trajectory: o.trajectoryStatus, rationale: o.rationale,
    scoreDelta: o.scoreAtClose != null && o.scoreAtStart != null ? o.scoreAtClose - o.scoreAtStart : null,
    required: o.items.filter((i) => i.required),
    completed: o.items.filter((i) => i.required && i.completed),
    missed: dayStart(date, user.timezone) < now && date !== dayKey(now, user.timezone) ? o.items.filter((i) => i.required && !i.completed) : [],
    optional: o.items.filter((i) => !i.required),
    problems: problems.map((p) => ({ platform: p.platform, id: p.external_problem_id, title: p.title ?? p.external_problem_id, url: p.url, source: p.source, at: (p.first_accepted_at as Date).toISOString() })),
    contests: contests.map((c) => ({ title: c.title, platform: c.platform, ratingDelta: c.rating_delta })),
  };
}

export async function awardsView(db: Db, userId: string) {
  const held = new Map((await db.query('select award_type, achieved_at from awards where user_id=$1', [userId])).rows.map((r) => [r.award_type, r.achieved_at as Date]));
  const m = await awardMetrics(db, userId);
  return {
    awards: AWARD_DEFINITIONS.map((a) => ({
      key: a.key, figure: a.figure, unit: a.unit, title: a.title,
      achievedAt: held.get(a.key)?.toISOString() ?? null,
    })),
    metrics: m,
  };
}

export async function analyticsView(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const snaps = await loadSnapshots(db, userId);
  const today = dayKey(now, user.timezone);
  const series = dailySeries(snaps, today, user.timezone);
  const velocity = series.slice(1).map((d, i) => ({ day: d.day, gain: d.score - series[i].score }));
  const ratings = (await db.query(
    'select platform, rating, recorded_at from rating_history where user_id=$1 order by recorded_at', [userId],
  )).rows.map((r) => ({ platform: r.platform as Platform, rating: r.rating as number, at: (r.recorded_at as Date).toISOString() }));
  const contestRows = (await db.query(
    `select c.title, c.platform, c.start_at, cp.rating_delta, cp.rating_after from contest_participations cp
       join contests c on c.id = cp.contest_id where cp.user_id=$1 and cp.participated order by c.start_at desc limit 20`, [userId],
  )).rows.map((r) => ({ title: r.title, platform: r.platform as Platform, at: (r.start_at as Date).toISOString(), delta: r.rating_delta as number | null, after: r.rating_after as number | null }));
  const solvedWeekly = (await db.query(
    `select platform, date_trunc('week', first_accepted_at at time zone $2)::date as week, count(*)::int n
       from solved_problems where user_id=$1 and first_accepted_at > $3 group by 1,2 order by 2`,
    [userId, user.timezone, new Date(now - 84 * 86_400_000)],
  )).rows.map((r) => ({ platform: r.platform as Platform, week: String(r.week).slice(0, 10), count: r.n as number }));
  const { consistency, days } = await consistencyFor(db, userId, now, user.timezone);
  const loaded = await loadScore(db, userId);
  const v = scoreView(loaded);
  const { trajectory } = await computeTrajectoryFor(db, userId, now);
  return {
    velocity, ratings, contests: contestRows, solvedWeekly, consistency,
    weeks: days.slice(-28), trajectory,
    contribution: [
      ...v.components.map((c) => ({ label: c.label, value: c.total })),
      ...v.manual.map((c) => ({ label: c.label, value: c.total })),
    ],
  };
}

export async function problemsView(db: Db, userId: string, now: number) {
  const today = await computeToday(db, userId, now);
  const selected = today.objective.items.flatMap((i) => i.suggestions.map((p) => ({ ...p, itemId: i.id, reason: i.reason })));
  const solved = new Set((await db.query('select platform, external_problem_id from solved_problems where user_id=$1', [userId])).rows.map((r) => `${r.platform}:${r.external_problem_id}`));
  const pool = (await db.query('select platform, external_problem_id, title, url, difficulty, topic from problems order by platform, title')).rows;
  const recent = (await db.query(
    `select sp.platform, sp.external_problem_id, sp.first_accepted_at, sp.source, p.title, p.url, p.difficulty, p.topic
       from solved_problems sp left join problems p on p.platform=sp.platform and p.external_problem_id=sp.external_problem_id
      where sp.user_id=$1 order by sp.first_accepted_at desc limit 20`, [userId],
  )).rows;
  return {
    selectedToday: selected.map((p) => ({ ...p, solved: solved.has(`${p.platform}:${p.externalId}`) })),
    recentlySolved: recent.map((r) => ({ platform: r.platform, id: r.external_problem_id, title: r.title ?? r.external_problem_id, url: r.url, difficulty: r.difficulty, topic: r.topic, at: (r.first_accepted_at as Date).toISOString(), source: r.source })),
    pool: pool.map((r) => ({ platform: r.platform as Platform, id: r.external_problem_id, title: r.title, url: r.url, difficulty: r.difficulty, topic: r.topic, solved: solved.has(`${r.platform}:${r.external_problem_id}`) })),
    manualAllowed: { leetcode: true, codechef: true, codeforces: false, smartinterviews: false, interviewbit: false, hackerrank: false },
  };
}
