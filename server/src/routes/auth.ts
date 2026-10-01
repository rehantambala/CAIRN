import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { identitiesOf, unlinkIdentity } from '../services/identity.js';

export const COOKIE = 'vector_session';

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export interface AuthedRequest extends Request { userId: string }

/** The signed-in user's id from the session cookie, or null. Identity always comes from here, never from a request parameter. */
export function sessionUserId(req: Request): string | null {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try { return (jwt.verify(token, config.jwtSecret) as { sub: string }).sub; } catch { return null; }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const id = sessionUserId(req);
  if (!id) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  try {
    // Confirms the account still exists and records activity (at most every five minutes).
    const r = await pool.query(
      `update users set last_seen_at = case when last_seen_at is null or last_seen_at < now() - interval '5 minutes' then now() else last_seen_at end
        where id=$1 returning id`, [id]);
    if (!r.rowCount) {
      res.clearCookie(COOKIE, { path: '/' });
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
  } catch { return res.status(401).json({ error: 'UNAUTHENTICATED' }); }
  (req as AuthedRequest).userId = id;
  next();
}

export function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 86_400_000, path: '/' });
}

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const u = (await pool.query('select id, password_hash from users where lower(email)=$1', [body.data.email.toLowerCase()])).rows[0];
  const ok = !!u?.password_hash && (await bcrypt.compare(body.data.password, u.password_hash));
  if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  issueSession(res, u.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Returns 200 either way so a signed-out visit is not logged as a network error.
authRouter.get('/me', async (req, res) => {
  const id = sessionUserId(req);
  if (!id) return res.json({ authenticated: false });
  const u = (await pool.query('select id, email, display_name, avatar_url from users where id=$1', [id])).rows[0];
  if (!u) return res.json({ authenticated: false });
  res.json({ authenticated: true, id: u.id, email: u.email, displayName: u.display_name, avatarUrl: u.avatar_url });
});

authRouter.get('/identities', requireAuth, async (req, res) => {
  const id = (req as AuthedRequest).userId;
  const hasPassword = !!(await pool.query('select password_hash from users where id=$1', [id])).rows[0]?.password_hash;
  res.json({ identities: await identitiesOf(pool, id), hasPassword });
});

authRouter.delete('/identities/:provider', requireAuth, async (req, res) => {
  const provider = z.enum(['google', 'github']).safeParse(req.params.provider);
  if (!provider.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const r = await unlinkIdentity(pool, (req as AuthedRequest).userId, provider.data);
  if (r === 'LAST_METHOD') return res.status(409).json({ error: 'LAST_METHOD', message: 'This is your only way to sign in. Link another provider first.' });
  res.json({ ok: r === 'REMOVED' });
});
