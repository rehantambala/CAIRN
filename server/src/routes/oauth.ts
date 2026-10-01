import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { tx } from '../db/pool.js';
import { resolveIdentity, type Provider, type ProviderProfile } from '../services/identity.js';
import { issueSession, readCookie, sessionUserId } from './auth.js';

/**
 * "Continue with Google" and "Continue with GitHub" for anyone. Authorisation-code flow with a signed state
 * cookie and PKCE (S256); secrets stay on the server. Scopes are the minimum needed to identify a person.
 */
export const oauthRouter = Router();
const STATE_COOKIE = 'cairn_oauth';

const PROVIDERS: Record<Provider, { authorize: string; token: string; scope: string; enabled: () => boolean; clientId: () => string; secret: () => string; redirect: () => string }> = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user',
    enabled: () => !!(config.githubClientId && config.githubClientSecret), clientId: () => config.githubClientId, secret: () => config.githubClientSecret,
    redirect: () => config.githubRedirectUri,
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile',
    enabled: () => !!(config.googleClientId && config.googleClientSecret), clientId: () => config.googleClientId, secret: () => config.googleClientSecret,
    redirect: () => config.googleRedirectUri,
  },
};

/** Provider HTTP, replaceable in tests. */
export const providerHttp = {
  async postForm(url: string, body: Record<string, string>): Promise<any> {
    const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    return res.json();
  },
  async getJson(url: string, token: string): Promise<any> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'cairn' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`profile HTTP ${res.status}`);
    return res.json();
  },
};

const b64url = (b: Buffer) => b.toString('base64url');
const callbackFor = (req: Request, p: Provider) =>
  PROVIDERS[p].redirect() || `${config.publicUrl || `${req.protocol}://${req.get('host')}`}/api/auth/${p}/callback`;

oauthRouter.get('/providers', (_req, res) => res.json({ github: PROVIDERS.github.enabled(), google: PROVIDERS.google.enabled() }));

function start(provider: Provider) {
  return (req: Request, res: Response) => {
    const P = PROVIDERS[provider];
    if (!P.enabled()) return res.redirect('/?auth=unavailable');
    const state = b64url(randomBytes(18));
    const verifier = b64url(randomBytes(32));
    const link = req.query.link === '1';
    const tz = typeof req.query.tz === 'string' ? req.query.tz.slice(0, 64) : null;
    res.cookie(STATE_COOKIE, jwt.sign({ provider, state, verifier, link, tz }, config.jwtSecret, { expiresIn: '10m' }),
      { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 600_000, path: '/api/auth' });
    const q = new URLSearchParams({
      client_id: P.clientId(), redirect_uri: callbackFor(req, provider), state, scope: P.scope,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      ...(provider === 'google' ? { response_type: 'code', prompt: 'select_account' } : {}),
    });
    res.redirect(`${P.authorize}?${q}`);
  };
}

async function profileFor(provider: Provider, code: string, verifier: string, redirectUri: string): Promise<ProviderProfile | null> {
  const P = PROVIDERS[provider];
  const t = await providerHttp.postForm(P.token, {
    client_id: P.clientId(), client_secret: P.secret(), code, redirect_uri: redirectUri, code_verifier: verifier,
    ...(provider === 'google' ? { grant_type: 'authorization_code' } : {}),
  });
  if (!t?.access_token) return null;
  if (provider === 'github') {
    const u = await providerHttp.getJson('https://api.github.com/user', t.access_token);
    if (typeof u?.id !== 'number' && typeof u?.id !== 'string') return null;
    return { provider, providerUserId: String(u.id), email: typeof u.email === 'string' ? u.email : null, emailVerified: false,
      login: typeof u.login === 'string' ? u.login : null, name: typeof u.name === 'string' ? u.name : null, avatarUrl: typeof u.avatar_url === 'string' ? u.avatar_url : null };
  }
  const u = await providerHttp.getJson('https://openidconnect.googleapis.com/v1/userinfo', t.access_token);
  if (typeof u?.sub !== 'string') return null;
  return { provider, providerUserId: u.sub, email: typeof u.email === 'string' ? u.email : null, emailVerified: u.email_verified === true,
    login: null, name: typeof u.name === 'string' ? u.name : null, avatarUrl: typeof u.picture === 'string' ? u.picture : null };
}

function finish(provider: Provider) {
  return async (req: Request, res: Response) => {
    res.clearCookie(STATE_COOKIE, { path: '/api/auth' });
    try {
      if (!PROVIDERS[provider].enabled()) return res.redirect('/?auth=unavailable');
      if (typeof req.query.error === 'string') return res.redirect('/?auth=cancelled');
      const raw = readCookie(req, STATE_COOKIE);
      let st: { provider: string; state: string; verifier: string; link: boolean; tz: string | null };
      try { st = jwt.verify(raw ?? '', config.jwtSecret) as typeof st; } catch { return res.redirect('/?auth=failed'); }
      if (st.provider !== provider || st.state !== req.query.state || typeof req.query.code !== 'string') return res.redirect('/?auth=failed');

      const profile = await profileFor(provider, req.query.code, st.verifier, callbackFor(req, provider));
      if (!profile) return res.redirect('/?auth=failed');
      const current = st.link ? sessionUserId(req) : null;
      const r = await tx((c) => resolveIdentity(c, profile, current, st.tz));
      if (r.outcome === 'CONFLICT') return res.redirect(current ? '/settings?auth=conflict' : '/?auth=conflict');
      issueSession(res, r.userId!);
      res.redirect(r.outcome === 'LINKED' ? '/settings?auth=linked' : r.outcome === 'CREATED' ? '/?welcome=1' : '/');
    } catch (e) {
      console.error('oauth', provider, (e as Error).message);
      res.redirect('/?auth=failed');
    }
  };
}

for (const p of ['github', 'google'] as const) {
  oauthRouter.get(`/${p}/start`, start(p));
  oauthRouter.get(`/${p}/callback`, finish(p));
}
