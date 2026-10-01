import { join } from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { api } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { oauthRouter } from './routes/oauth.js';
import { jobsRouter } from './routes/jobs.js';
import { corsOptions, csrfGuard, errorHandler, httpsOnly, limiter, requestLog, routeOf, securityHeaders } from './routes/security.js';

/** The API, and optionally the built frontend from `staticDir`, with the error handler last. */
export function createApp(staticDir?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);              // exactly one proxy (Render's edge) sets X-Forwarded-For and -Proto
  app.use(requestLog);
  app.use(securityHeaders);
  app.use(httpsOnly);
  app.use('/api', cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', limiter({ windowMs: 60_000, limit: 240, by: 'ip', name: 'api' }));
  app.use('/api', csrfGuard);

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  // Public, no account needed: the contact address for the privacy and terms pages.
  app.get('/api/public/info', (_req, res) => {
    res.json({ contact: /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(config.supportEmail) ? config.supportEmail : null });
  });
  /**
   * Google Search Console verification. Google asks for a file named google<token>.html whose body is
   * "google-site-verification: google<token>.html". The token comes from configuration and is strictly
   * validated, so this route can only ever serve that one file name and never anything else.
   */
  app.get(/^\/google[0-9a-f]{8,32}\.html$/i, (req, res, next) => {
    const token = config.googleSiteVerification;
    if (!/^google[0-9a-f]{8,32}$/i.test(token) || routeOf(req).toLowerCase() !== `/${token.toLowerCase()}.html`) return next();
    res.type('text/html').send(`google-site-verification: ${token}.html`);
  });
  app.use('/api/auth', oauthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  if (staticDir) {
    app.use(express.static(staticDir, { index: false, setHeaders: (res, path) => {
      // Hashed build assets never change; everything else (the shell, the service worker) is revalidated.
      res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    } }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(staticDir, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}
