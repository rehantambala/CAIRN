import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, tx } from '../db/pool.js';
import { ADAPTERS } from '../adapters/index.js';
import { ALL_PLATFORMS, RATED_PLATFORMS, type Platform } from '../domain/types.js';
import { DEFAULT_TZ } from '../domain/time.js';
import { ensureObjective } from '../services/derived.js';
import { recordParticipation, recordRating } from '../services/contests.js';
import { nextKey, processAccepted, refreshAfterChange } from '../services/pipeline.js';
import { pushConfigured } from '../services/notify.js';
import { getUser, loadScore, recordEvent } from '../services/state.js';
import { runJob } from '../services/jobs.js';
import { syncPlatform } from '../services/sync.js';
import { rebaseline } from '../services/baseline.js';
import { connectAndSync, discoverFromGitHub, extractHandles } from '../services/accounts.js';
import {
  analyticsView, awardsView, calendarView, contestsView, dayDetail, overview, problemsView,
  scoreView, simulate, sourcesView, trajectoryView,
} from '../services/views.js';
import { requireAuth, type AuthedRequest } from './auth.js';
import { closePastDays, applyCommitmentToToday } from '../services/derived.js';

export const api = Router();
api.use(requireAuth);

const uid = (req: Request) => (req as AuthedRequest).userId;
const platformSchema = z.enum(ALL_PLATFORMS as [Platform, ...Platform[]]);
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_INPUT', issues: e.issues });
    console.error(e);
    res.status(500).json({ error: 'INTERNAL' });
  });
};

// ---- read views ----
api.get('/overview', wrap(async (req, res) => { res.json(await overview(pool, uid(req), Date.now())); }));

api.get('/today', wrap(async (req, res) => {
  const now = Date.now();
  const o = await overview(pool, uid(req), now);
  res.json({ date: o.date, objective: o.today, next: o.next, trajectory: o.trajectory, contests: o.upcomingContests });
}));

api.get('/contests', wrap(async (req, res) => { res.json(await contestsView(pool, uid(req), Date.now())); }));
api.get('/problems', wrap(async (req, res) => { res.json(await problemsView(pool, uid(req), Date.now())); }));
api.get('/trajectory', wrap(async (req, res) => { res.json(await trajectoryView(pool, uid(req), Date.now())); }));
api.get('/awards', wrap(async (req, res) => { res.json(await awardsView(pool, uid(req))); }));
api.get('/analytics', wrap(async (req, res) => { res.json(await analyticsView(pool, uid(req), Date.now())); }));

api.get('/calendar', wrap(async (req, res) => {
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  res.json(await calendarView(pool, uid(req), month, Date.now()));
}));

api.get('/calendar/:date', wrap(async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.params.date);
  res.json(await dayDetail(pool, uid(req), date, Date.now()));
}));

api.get('/score', wrap(async (req, res) => {
  const loaded = await loadScore(pool, uid(req));
  const user = await getUser(pool, uid(req));
  res.json({ ...scoreView(loaded), target: user.targetScore, remaining: Math.max(0, user.targetScore - loaded.score.overall), sources: sourcesView(loaded.stats) });
}));

const ratedSchema = z.object({ problems: z.number().int().min(0).max(100000), rating: z.number().int().min(0).max(4500), contests: z.number().int().min(0).max(10000) });
const simSchema = z.object({
  leetcode: ratedSchema, codechef: ratedSchema, codeforces: ratedSchema,
  hackerrank: z.number().int().min(0).max(1_000_000), smartinterviews: z.number().int().min(0).max(1_000_000), interviewbit: z.number().int().min(0).max(1_000_000),
});
api.post('/score/simulate', wrap(async (req, res) => {
  const sim = simSchema.parse(req.body);
  const loaded = await loadScore(pool, uid(req));
  const user = await getUser(pool, uid(req));
  res.json(simulate(loaded.inputs, sim, user.targetScore));
}));

// ---- actions ----
/** Lazy rollover: closes past days and creates today's objective. The scheduled job does the same. */
api.post('/refresh', wrap(async (req, res) => {
  const now = Date.now();
  await tx(async (c) => {
    await closePastDays(c, uid(req), now);
    await ensureObjective(c, uid(req), now);
    await refreshAfterChange(c, uid(req), now, 'refresh');
  });
  await runJob('notify', now);
  res.json({ ok: true });
}));

api.post('/contests/:id/commit', wrap(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const prep = z.object({ prepMinutes: z.number().int().min(0).max(240).default(30) }).parse(req.body ?? {}).prepMinutes;
  const c = (await pool.query('select id, end_at from contests where id=$1', [id])).rows[0];
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  if ((c.end_at as Date).getTime() < Date.now()) return res.status(409).json({ error: 'CONTEST_FINISHED' });
  await tx(async (cl) => {
    await cl.query(
      `insert into contest_commitments(user_id, contest_id, prep_minutes) values ($1,$2,$3)
       on conflict (user_id, contest_id) do update set prep_minutes = excluded.prep_minutes`, [uid(req), id, prep],
    );
    await recordEvent(cl, uid(req), 'REMINDER_SCHEDULED', null, id, { commitment: true });
    await applyCommitmentToToday(cl, uid(req), id, true, Date.now());
  });
  await runJob('notify');
  res.json({ ok: true, message: 'Your commitment is recorded, and reminders are scheduled.' });
}));

api.delete('/contests/:id/commit', wrap(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await tx((cl) => cl.query('delete from contest_commitments where user_id=$1 and contest_id=$2', [uid(req), id]).then(() => applyCommitmentToToday(cl, uid(req), id, false, Date.now())));
  await pool.query(`delete from notifications where user_id=$1 and payload_json->>'contestId'=$2 and status='PENDING' and type in ('CONTEST_1H','CONTEST_10M','CONTEST_CLOSED')`, [uid(req), id]);
  res.json({ ok: true });
}));

// Manual fallback. Only for platforms with no authoritative feed.
api.post('/contests/:id/attended', wrap(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const c = (await pool.query('select platform, start_at from contests where id=$1', [id])).rows[0];
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  const linkedPlat = ADAPTERS[c.platform as Platform].capability === 'AUTOMATIC'
    && (await pool.query(`select 1 from platform_accounts where user_id=$1 and platform=$2 and username <> ''`, [uid(req), c.platform])).rowCount;
  if (linkedPlat) return res.status(409).json({ error: 'VERIFIED_SOURCE', message: 'This platform is read from your public profile, so manual recording is not available.' });
  if ((c.start_at as Date).getTime() > Date.now()) return res.status(409).json({ error: 'NOT_STARTED' });
  await tx(async (cl) => {
    await recordParticipation(cl, uid(req), c.platform, id, { source: 'MANUAL' });
    await refreshAfterChange(cl, uid(req), Date.now(), 'manual-contest');
  });
  res.json({ ok: true });
}));

api.post('/problems/solve', wrap(async (req, res) => {
  const b = z.object({ platform: platformSchema, externalId: z.string().min(1).max(200) }).parse(req.body);
  if (ADAPTERS[b.platform].capability === 'AUTOMATIC') {
    const linked = (await pool.query(`select 1 from platform_accounts where user_id=$1 and platform=$2 and username <> ''`, [uid(req), b.platform])).rowCount;
    if (linked) return res.status(409).json({ error: 'VERIFIED_SOURCE', message: 'This platform is read from your public profile. Run a synchronisation instead.' });
  }
  if (!RATED_PLATFORMS.includes(b.platform as any)) return res.status(400).json({ error: 'NOT_A_PROBLEM_PLATFORM' });
  const r = await processAccepted(uid(req), { platform: b.platform, externalProblemId: b.externalId, acceptedAt: new Date(), source: 'MANUAL' });
  res.json(r);
}));

api.post('/sync/:platform', wrap(async (req, res) => {
  const platform = platformSchema.parse(req.params.platform);
  res.json(await syncPlatform(uid(req), platform));
}));

api.put('/accounts/:platform', wrap(async (req, res) => {
  const platform = platformSchema.parse(req.params.platform);
  const { username } = z.object({ username: z.string().trim().max(80).regex(/^[A-Za-z0-9_.-]*$/) }).parse(req.body);
  await pool.query(
    `insert into platform_accounts(user_id, platform, username, connection_status) values ($1,$2,$3,$4)
     on conflict (user_id, platform) do update set username=excluded.username, connection_status=excluded.connection_status, updated_at=now()`,
    [uid(req), platform, username, username ? 'CONNECTED' : 'DISCONNECTED'],
  );
  res.json({ ok: true });
}));

/**
 * One step instead of three forms: paste any profile links (or let the signed-in GitHub profile be read) and every
 * recognised handle is saved and synchronised. Handles already chosen are kept unless `replace` is given.
 */
api.post('/accounts/discover', wrap(async (req, res) => {
  const b = z.object({ text: z.string().max(5000).optional(), github: z.boolean().optional(), replace: z.boolean().optional() }).parse(req.body ?? {});
  let handles = extractHandles([b.text]);
  if (b.github) {
    const gh = (await pool.query('select github_login from users where id=$1', [uid(req)])).rows[0]?.github_login as string | null;
    if (!gh) return res.status(409).json({ error: 'NO_GITHUB', message: 'Sign in with GitHub once, and your public profile can be read.' });
    handles = { ...(await discoverFromGitHub(gh)), ...handles };
  }
  if (Object.keys(handles).length === 0) return res.json({ found: {}, saved: [], reports: [], message: 'No LeetCode, CodeChef or Codeforces profile address was recognised.' });
  const r = await connectAndSync(uid(req), handles, !!b.replace);
  res.json({ found: handles, ...r });
}));

const importSchema = z.object({
  platform: platformSchema,
  problemsSolved: z.number().int().min(0).max(100000).optional(),
  contests: z.number().int().min(0).max(10000).optional(),
  rating: z.number().int().min(0).max(4500).optional(),
  contribution: z.number().int().min(0).max(1_000_000).optional(),
  solved: z.array(z.object({ id: z.string().min(1).max(200), acceptedAt: z.string().datetime().optional() })).max(5000).optional(),
  note: z.string().max(200).optional(),
});

/**
 * User-owned statistics: a new baseline from the platform's own numbers.
 * Counts move the derived baseline to "now" so later accepted problems are counted on top, once.
 */
api.post('/import', wrap(async (req, res) => {
  const b = importSchema.parse(req.body);
  const status = b.contribution !== undefined && !['leetcode', 'codechef', 'codeforces'].includes(b.platform) ? 'MANUAL' : 'IMPORTED';
  await tx(async (c) => {
    const now = new Date();
    await c.query(
      `insert into platform_stats(user_id, platform, base_as_of, source_status, source_note, last_updated_at)
       values ($1,$2,$3,$4,$5,$3) on conflict (user_id, platform) do nothing`, [uid(req), b.platform, now, status, b.note ?? null],
    );
    if (b.problemsSolved !== undefined || b.contests !== undefined) {
      // Re-baseline: the imported totals are authoritative as of now.
      await rebaseline(c, uid(req), b.platform, { problems: b.problemsSolved, contests: b.contests }, now);
    }
    if (b.contribution !== undefined) await c.query('update platform_stats set contribution=$3 where user_id=$1 and platform=$2', [uid(req), b.platform, b.contribution]);
    await c.query('update platform_stats set source_status=$3, source_note=$4, last_updated_at=$5 where user_id=$1 and platform=$2', [uid(req), b.platform, status, b.note ?? null, now]);
    if (b.rating !== undefined) await recordRating(c, uid(req), b.platform, b.rating, now, null);
    for (const s of b.solved ?? []) {
      // Historic ids are remembered (never re-suggested, never double counted) unless a real timestamp is given.
      await import('../services/pipeline.js').then((m) => m.ingestAccepted(c, uid(req), {
        platform: b.platform, externalProblemId: s.id, acceptedAt: s.acceptedAt ? new Date(s.acceptedAt) : new Date(0), source: 'IMPORT',
      }));
    }
    await recordEvent(c, uid(req), 'PLATFORM_SYNCED', b.platform, null, { import: true });
    await refreshAfterChange(c, uid(req), Date.now(), `import:${b.platform}`);
  });
  res.json({ ok: true, status });
}));

api.post('/codeforces/derive-from-history', wrap(async (req, res) => {
  // After a verified sync, let synced history be the only source of truth for Codeforces counts.
  await tx(async (c) => {
    await c.query(`update platform_stats set base_problems=0, base_contests=0, base_as_of='epoch' where user_id=$1 and platform='codeforces'`, [uid(req)]);
    await refreshAfterChange(c, uid(req), Date.now(), 'cf-derive');
  });
  res.json({ ok: true });
}));

api.get('/settings', wrap(async (req, res) => {
  const user = await getUser(pool, uid(req));
  const loaded = await loadScore(pool, uid(req));
  res.json({
    user: { ...user, githubLogin: (await pool.query('select github_login from users where id=$1', [uid(req)])).rows[0]?.github_login ?? null },
    sources: sourcesView(loaded.stats),
    push: { configured: pushConfigured(), publicKey: config.vapidPublic || null },
    dev: !config.isProd,
  });
}));

api.put('/settings', wrap(async (req, res) => {
  const b = z.object({
    displayName: z.string().trim().min(1).max(60).optional(),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }).optional(),
    targetScore: z.number().int().min(1000).max(1_000_000).optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dailyMinutes: z.number().int().min(30).max(480).optional(),
  }).parse(req.body);
  await pool.query(
    `update users set display_name=coalesce($2,display_name), timezone=coalesce($3,timezone), target_score=coalesce($4,target_score),
       daily_minutes=coalesce($6,daily_minutes), target_date = case when $5::boolean then $7::date else target_date end, updated_at=now() where id=$1`,
    [uid(req), b.displayName ?? null, b.timezone ?? null, b.targetScore ?? null, b.targetDate !== undefined, b.dailyMinutes ?? null, b.targetDate ?? null],
  );
  res.json({ ok: true });
}));

api.post('/push/subscribe', wrap(async (req, res) => {
  const b = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
  await pool.query(
    `insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)
     on conflict (endpoint) do update set p256dh=excluded.p256dh, auth=excluded.auth`, [uid(req), b.endpoint, b.keys.p256dh, b.keys.auth],
  );
  res.json({ ok: true });
}));

api.get('/notifications', wrap(async (req, res) => {
  const rows = (await pool.query(
    `select type, status, scheduled_for, delivered_at, payload_json from notifications where user_id=$1
      order by scheduled_for desc limit 30`, [uid(req)],
  )).rows;
  res.json(rows.map((r) => ({
    type: r.type, status: r.status, scheduledFor: r.scheduled_for, deliveredAt: r.delivered_at,
    body: r.payload_json?.message?.body ?? null, reason: r.payload_json?.reason ?? null,
  })));
}));

// ---- development-only simulation, for verifying the loop without a live platform ----
if (!config.isProd) {
  api.post('/dev/accept', wrap(async (req, res) => {
    const b = z.object({ platform: platformSchema, externalId: z.string().optional() }).parse(req.body);
    const id = b.externalId ?? `dev-${Date.now()}`;
    res.json(await processAccepted(uid(req), {
      platform: b.platform, externalProblemId: id, externalSubmissionId: `dev-sub-${id}`, acceptedAt: new Date(), source: 'SYNC',
    }));
  }));
  api.post('/dev/contest-result', wrap(async (req, res) => {
    const b = z.object({ contestId: z.string().uuid(), ratingAfter: z.number().int().optional() }).parse(req.body);
    const c = (await pool.query('select platform from contests where id=$1', [b.contestId])).rows[0];
    if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
    await tx(async (cl) => {
      await recordParticipation(cl, uid(req), c.platform, b.contestId, { source: 'SYNC' });
      if (b.ratingAfter !== undefined) await recordRating(cl, uid(req), c.platform, b.ratingAfter, new Date(), null);
      await refreshAfterChange(cl, uid(req), Date.now(), 'dev-contest');
    });
    res.json({ ok: true });
  }));
  api.get('/dev/next-key', wrap(async (req, res) => { res.json({ key: await nextKey(pool, uid(req), Date.now()) }); }));
}

void DEFAULT_TZ;
