import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { JOB_NAMES, runAll, runJobExclusive, type JobName } from '../services/jobs.js';
import { limiter, log, routeOf, safe } from './security.js';

export const jobsRouter = Router();

/** Constant-time comparison of fixed-length digests, so neither content nor length leaks through timing. */
function authorized(header: string | undefined): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const got = createHash('sha256').update(m[1].trim()).digest();
  const want = createHash('sha256').update(config.cronSecret).digest();
  return timingSafeEqual(got, want);
}

// Invoked by any free scheduler (GitHub Actions, Supabase pg_cron, cron-job.org). Never callable without the secret.
jobsRouter.post('/:name', limiter({ windowMs: 60_000, limit: 20, by: 'ip', name: 'jobs' }), safe(async (req, res) => {
  if (!authorized(req.headers.authorization)) {
    log('warn', 'job request refused', { requestId: res.locals.requestId, route: routeOf(req) });
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  const name = req.params.name;
  try {
    if (name === 'all') return res.json(await runAll());
    if (!(JOB_NAMES as readonly string[]).includes(name)) return res.status(404).json({ error: 'UNKNOWN_JOB' });
    res.json(await runJobExclusive(name as JobName));
  } catch (e: any) {
    log('error', 'job failed', { requestId: res.locals.requestId, job: name, error: String(e?.message ?? e) });
    res.status(500).json({ error: 'JOB_FAILED', requestId: res.locals.requestId });
  }
}));
