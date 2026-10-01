import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { connectAndSync, discoverFromGitHub } from '../services/accounts.js';
import { issueSession, readCookie } from './auth.js';

/**
 * Sign-in with GitHub or Google, for the owner alone. This is a single-owner instrument: a verified identity
 * is accepted only if it is the configured owner's, and otherwise refused, so that configuring a provider can
 * never open the application to anyone else.
 */
export const oauthRouter = Router();
const STATE_COOKIE = 'cairn_oauth';

const enabled = {
  github: () => !!(config.githubClientId && config.githubClientSecret && config.ownerGithub),
  google: () => !!(config.googleClientId && config.googleClientSecret && (config.ownerGoogleEmail || config.ownerEmail)),
};

const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const callback = (req: Request, p: 'github' | 'google') => `${origin(req)}/api/auth/${p}/callback`;

oauthRouter.get('/providers', (_req, res) => res.json({ github: enabled.github(), google: enabled.google() }));

function start(provider: 'github' | 'google') {
  return (req: Request, res: Response) => {
    if (!enabled[provider]()) return res.redirect('/?auth=unavailable');
    const state = randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, jwt.sign({ provider, state }, config.jwtSecret, { expiresIn: '10m' }), { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 600_000, path: '/api/auth' });
    const q = new URLSearchParams(provider === 'github'
      ? { client_id: config.githubClientId, redirect_uri: callback(req, 'github'), state, scope: 'read:user', allow_signup: 'false' }
      : { client_id: config.googleClientId, redirect_uri: callback(req, 'google'), state, scope: 'openid email', response_type: 'code', prompt: 'select_account' });
    res.redirect(`${provider === 'github' ? 'https://github.com/login/oauth/authorize' : 'https://accounts.google.com/o/oauth2/v2/auth'}?${q}`);
  };
}
oauthRouter.get('/github/start', start('github'));
oauthRouter.get('/google/start', start('google'));

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  return (await res.json()) as any;
}
async function getAuthed(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'cairn-personal' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`profile HTTP ${res.status}`);
  return (await res.json()) as any;
}

function stateOk(req: Request, provider: string): boolean {
  const raw = readCookie(req, STATE_COOKIE);
  if (!raw || typeof req.query.state !== 'string') return false;
  try {
    const p = jwt.verify(raw, config.jwtSecret) as { provider: string; state: string };
    return p.provider === provider && p.state === req.query.state;
  } catch { return false; }
}

async function ownerId(): Promise<string | null> {
  return (await pool.query('select id from users where email=$1', [config.ownerEmail.toLowerCase()])).rows[0]?.id ?? null;
}

function finish(provider: 'github' | 'google') {
  return async (req: Request, res: Response) => {
    res.clearCookie(STATE_COOKIE, { path: '/api/auth' });
    try {
      if (!enabled[provider]() || !stateOk(req, provider) || typeof req.query.code !== 'string') return res.redirect('/?auth=failed');
      let allowed = false;
      let githubLogin: string | null = null;
      if (provider === 'github') {
        const t = await postForm('https://github.com/login/oauth/access_token', {
          client_id: config.githubClientId, client_secret: config.githubClientSecret, code: req.query.code, redirect_uri: callback(req, 'github'),
        });
        if (!t.access_token) return res.redirect('/?auth=failed');
        const u = await getAuthed('https://api.github.com/user', t.access_token);
        githubLogin = typeof u.login === 'string' ? u.login : null;
        allowed = !!githubLogin && githubLogin.toLowerCase() === config.ownerGithub.toLowerCase();
      } else {
        const t = await postForm('https://oauth2.googleapis.com/token', {
          client_id: config.googleClientId, client_secret: config.googleClientSecret, code: req.query.code, redirect_uri: callback(req, 'google'), grant_type: 'authorization_code',
        });
        if (!t.access_token) return res.redirect('/?auth=failed');
        const u = await getAuthed('https://openidconnect.googleapis.com/v1/userinfo', t.access_token);
        const want = (config.ownerGoogleEmail || config.ownerEmail).toLowerCase();
        allowed = u.email_verified === true && typeof u.email === 'string' && u.email.toLowerCase() === want;
      }
      if (!allowed) return res.redirect('/?auth=denied');
      const id = await ownerId();
      if (!id) return res.redirect('/?auth=failed');
      if (githubLogin) await pool.query('update users set github_login=$2, updated_at=now() where id=$1', [id, githubLogin]);
      issueSession(res, id);
      // Find and connect the platform accounts in the background; the person is not kept waiting.
      if (githubLogin) void discoverFromGitHub(githubLogin).then((h) => connectAndSync(id, h)).catch(() => {});
      res.redirect('/');
    } catch (e) {
      console.error('oauth', provider, (e as Error).message);
      res.redirect('/?auth=failed');
    }
  };
}
oauthRouter.get('/github/callback', finish('github'));
oauthRouter.get('/google/callback', finish('google'));
