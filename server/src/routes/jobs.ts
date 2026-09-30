import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { JOB_NAMES, runAll, runJob, type JobName } from '../services/jobs.js';

export const jobsRouter = Router();

function authorized(header: string | undefined): boolean {
  const got = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(config.cronSecret);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Invoked by any free scheduler (GitHub Actions, Vercel cron, Supabase pg_cron, cron-job.org).
jobsRouter.post('/:name', async (req, res) => {
  if (!authorized(req.headers.authorization)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const name = req.params.name;
    if (name === 'all') return res.json(await runAll());
    if (!(JOB_NAMES as readonly string[]).includes(name)) return res.status(404).json({ error: 'UNKNOWN_JOB' });
    res.json(await runJob(name as JobName));
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: 'JOB_FAILED', message: String(e?.message ?? e) });
  }
});
