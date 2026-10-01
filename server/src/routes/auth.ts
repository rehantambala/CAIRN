import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { identitiesOf, unlinkIdentity } from '../services/identity.js';
import { createSession, resolveSession, revokeAllSessions, revokeSession, SESSION_TTL_MS } from '../services/sessions.js';
import { limiter } from './security.js';

export const COOKIE = 'cairn_session';

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(v.join('=')); } catch { return null; }
    }
  }
  return null;
}

/**
 * Lax, not Strict: the OAuth callback arrives as a top-level navigation from Google or GitHub, and linking a second
 * provider needs the session on that request. Cross-site writes are refused separately by the CSRF guard.
 */
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: config.isProd, path: '/' });

export interface AuthedRequest extends Request { userId: string }

/** The signed-in user's id from the session cookie, or null. Identity always comes from here, never from a request parameter. */
export async function sessionUserId(req: Request): Promise<string | null> {
  return resolveSession(pool, readCookie(req, COOKIE));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  let id: string | null = null;
  try {
    id = await sessionUserId(req);
    if (id) {
      // Records activity at most every five minutes.
      await pool.query(`update users set last_seen_at = now() where id=$1 and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')`, [id]);
    }
  } catch { return res.status(503).json({ error: 'UNAVAILABLE' }); }
  if (!id) {
    if (readCookie(req, COOKIE)) res.clearCookie(COOKIE, cookieOptions());
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  (req as AuthedRequest).userId = id;
  res.locals.userId = id;
  next();
}

/** A new session for every sign-in; any session this browser already held is discarded first. */
export async function issueSession(req: Request, res: Response, userId: string) {
  await revokeSession(pool, readCookie(req, COOKIE));
  const { token } = await createSession(pool, userId);
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export const authRouter = Router();

// A fixed hash, so an unknown address costs the same time as a wrong password and accounts cannot be enumerated.
const DUMMY_HASH = bcrypt.hashSync('cairn-timing-equaliser', 10);

authRouter.post('/login', limiter({ windowMs: 15 * 60_000, limit: 10, by: 'ip' }), async (req, res) => {
  const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const u = (await pool.query('select id, password_hash from users where lower(email)=$1', [body.data.email.toLowerCase()])).rows[0];
  const ok = await bcrypt.compare(body.data.password, u?.password_hash ?? DUMMY_HASH);
  if (!ok || !u?.password_hash) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  await issueSession(req, res, u.id);
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  await revokeSession(pool, readCookie(req, COOKIE));
  res.clearCookie(COOKIE, cookieOptions());
  res.json({ ok: true });
});

/** Ends every session of this account, on every device. */
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  const n = await revokeAllSessions(pool, (req as AuthedRequest).userId);
  res.clearCookie(COOKIE, cookieOptions());
  res.json({ ok: true, ended: n });
});

// Returns 200 either way so a signed-out visit is not logged as a network error.
authRouter.get('/me', async (req, res) => {
  const id = await sessionUserId(req);
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
