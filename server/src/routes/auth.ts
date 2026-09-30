import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const COOKIE = 'vector_session';

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export interface AuthedRequest extends Request { userId: string }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string };
    (req as AuthedRequest).userId = p.sub;
    next();
  } catch {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
}

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const u = (await pool.query('select id, password_hash from users where email=$1', [body.data.email.toLowerCase()])).rows[0];
  const ok = u && (await bcrypt.compare(body.data.password, u.password_hash));
  if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  const token = jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 86_400_000, path: '/',
  });
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Returns 200 either way so a signed-out visit is not logged as a network error.
authRouter.get('/me', async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (!token) return res.json({ authenticated: false });
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string };
    const u = (await pool.query('select id, email, display_name from users where id=$1', [p.sub])).rows[0];
    if (!u) return res.json({ authenticated: false });
    res.json({ authenticated: true, id: u.id, email: u.email, displayName: u.display_name });
  } catch {
    res.json({ authenticated: false });
  }
});
