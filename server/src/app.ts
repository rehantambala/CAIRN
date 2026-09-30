import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { api } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use('/api/auth', authRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  return app;
}
