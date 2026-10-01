import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { tx } from '../db/pool.js';
import { resolveIdentity, validTimezone, type Provider, type ProviderProfile } from '../services/identity.js';
import { issueSession, readCookie, sessionUserId } from './auth.js';
import { limiter, log, safe } from './security.js';

/**
 * "Continue with Google" and "Continue with GitHub" for anyone. Authorisation-code flow, server side:
 *   start:    random state + PKCE verifier, kept in a signed, HttpOnly, 10-minute cookie bound to this browser;
 *             the browser is sent to the provider with the state and the S256 challenge only.
 *   callback: state must match the cookie exactly; the code is exchanged server to server with the client secret
 *             and the verifier; the stable provider id (Google `sub`, GitHub numeric `id`) identifies the person.
 * The provider's access token is used once to read the profile and is then discarded: it is never stored, logged,
 * returned or placed in a URL, and GitHub's is revoked immediately. Redirect URIs come only from configuration.
 */
export const oauthRouter = Router();
const STATE_COOKIE = 'cairn_oauth';
const STATE_TTL_S = 600;

interface ProviderDef {
  authorize: string; token: string; profile: string;
  /** Google: identity only. GitHub: no scope at all, which grants read access to public profile data and nothing else. */
  scope: string | null;
  clientId: () => string; secret: () => string; configuredRedirect: () => string;
}

const PROVIDERS: Record<Provider, ProviderDef> = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    profile: 'https://api.github.com/user', scope: null,
    clientId: () => config.githubClientId, secret: () => config.githubClientSecret, configuredRedirect: () => config.githubRedirectUri,
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile',
    clientId: () => config.googleClientId, secret: () => config.googleClientSecret, configuredRedirect: () => config.googleRedirectUri,
  },
};

/**
 * The one redirect URI for a provider, from configuration only: an explicit *_REDIRECT_URI, else PUBLIC_URL plus the
 * fixed callback path. The request's Host header is never used in production, so it cannot steer the callback.
 * Returns null when no valid URI is configured, which disables the provider.
 */
export function redirectUriFor(p: Provider, cfg: { isProd: boolean; publicUrl: string; explicit: string; devHost?: string }): string | null {
  const path = `/api/auth/${p}/callback`;
  const candidate = cfg.explicit || (cfg.publicUrl ? `${cfg.publicUrl}${path}` : !cfg.isProd && cfg.devHost ? `${cfg.devHost}${path}` : '');
  if (!candidate) return null;
  let u: URL;
  try { u = new URL(candidate); } catch { return null; }
  if (u.pathname !== path || u.search || u.hash || u.username || u.password) return null;
  if (cfg.isProd && u.protocol !== 'https:') return null;
  if (!['https:', 'http:'].includes(u.protocol)) return null;
  return u.toString();
}

const redirectFor = (p: Provider, req?: Request) => redirectUriFor(p, {
  isProd: config.isProd, publicUrl: config.publicUrl, explicit: PROVIDERS[p].configuredRedirect(),
  devHost: req ? `${req.protocol}://${req.get('host')}` : undefined,
});

export const providerEnabled = (p: Provider) =>
  !!(PROVIDERS[p].clientId() && PROVIDERS[p].secret() && (redirectFor(p) || !config.isProd));

export class ProviderError extends Error {
  constructor(public code: string) { super(code); }
}

/** Provider HTTP, replaceable in tests. Errors carry only the provider's error code, never a token or secret. */
export const providerHttp = {
  async postForm(url: string, body: Record<string, string>): Promise<any> {
    const res = await fetch(url, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'cairn' },
      body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    // GitHub answers 200 with {"error": ...} when it rejects an exchange; Google uses 4xx. Both are failures here.
    if (!res.ok || json?.error) throw new ProviderError(`token ${res.status}${json?.error ? ` ${String(json.error).slice(0, 60)}` : ''}`);
    return json;
  },
  async getJson(url: string, token: string): Promise<any> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'cairn' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ProviderError(`profile ${res.status}`);
    return res.json();
  },
  /** GitHub OAuth tokens do not expire on their own; the one used to read the profile is revoked at once. */
  async revokeGithub(token: string): Promise<void> {
    const basic = Buffer.from(`${config.githubClientId}:${config.githubClientSecret}`).toString('base64');
    await fetch(`https://api.github.com/applications/${encodeURIComponent(config.githubClientId)}/token`, {
      method: 'DELETE', headers: { Authorization: `Basic ${basic}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cairn', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }), signal: AbortSignal.timeout(10_000),
    });
  },
};

const b64url = (b: Buffer) => b.toString('base64url');
const STATE_RE = /^[A-Za-z0-9_-]{24}$/;
const CODE_RE = /^[A-Za-z0-9._\-\/~+]{1,512}$/;

oauthRouter.get('/providers', (_req, res) => res.json({ github: providerEnabled('github'), google: providerEnabled('google') }));

const startLimit = limiter({ windowMs: 15 * 60_000, limit: 30, by: 'ip', name: 'oauth-start' });
const callbackLimit = limiter({ windowMs: 15 * 60_000, limit: 30, by: 'ip', name: 'oauth-callback' });

interface StatePayload { provider: Provider; state: string; verifier: string; linkUser: string | null; tz: string | null }

function start(provider: Provider) {
  return safe(async (req: Request, res: Response) => {
    const P = PROVIDERS[provider];
    const redirectUri = redirectFor(provider, req);
    if (!providerEnabled(provider) || !redirectUri) return res.redirect(302, '/?auth=unavailable');
    // Linking adds a provider to the account that is signed in now, and only to that account.
    let linkUser: string | null = null;
    if (req.query.link === '1') {
      linkUser = await sessionUserId(req);
      if (!linkUser) return res.redirect(302, '/?auth=failed');
    }
    const state = b64url(randomBytes(18));
    const verifier = b64url(randomBytes(32));
    const tz = validTimezone(req.query.tz) ? req.query.tz : null;
    const payload: StatePayload = { provider, state, verifier, linkUser, tz };
    res.cookie(STATE_COOKIE, jwt.sign(payload, config.jwtSecret, { expiresIn: STATE_TTL_S, algorithm: 'HS256' }),
      { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: STATE_TTL_S * 1000, path: '/api/auth' });
    const q = new URLSearchParams({
      client_id: P.clientId(), redirect_uri: redirectUri, state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      ...(P.scope ? { scope: P.scope } : {}),
      ...(provider === 'google' ? { response_type: 'code', prompt: 'select_account' } : { allow_signup: 'true' }),
    });
    res.redirect(302, `${P.authorize}?${q}`);
  });
}

/** Exchanges the code and reads the stable identity. Anything unexpected is a failure, never a partial sign-in. */
export async function profileFor(provider: Provider, code: string, verifier: string, redirectUri: string): Promise<ProviderProfile> {
  const P = PROVIDERS[provider];
  const t = await providerHttp.postForm(P.token, {
    client_id: P.clientId(), client_secret: P.secret(), code, redirect_uri: redirectUri, code_verifier: verifier,
    ...(provider === 'google' ? { grant_type: 'authorization_code' } : {}),
  });
  const token = t?.access_token;
  if (typeof token !== 'string' || !token) throw new ProviderError('token missing');
  try {
    const u = await providerHttp.getJson(P.profile, token);
    if (provider === 'github') {
      if (!Number.isSafeInteger(u?.id) || u.id <= 0) throw new ProviderError('profile shape');
      return { provider, providerUserId: String(u.id), email: typeof u.email === 'string' ? u.email : null, emailVerified: false,
        login: typeof u.login === 'string' ? u.login.slice(0, 39) : null, name: typeof u.name === 'string' ? u.name : null,
        avatarUrl: typeof u.avatar_url === 'string' && u.avatar_url.startsWith('https://avatars.githubusercontent.com/') ? u.avatar_url : null };
    }
    // Google: "up to 255 case-sensitive ASCII characters, unique among all Google accounts and never reused".
    if (typeof u?.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(u.sub)) throw new ProviderError('profile shape');
    return { provider, providerUserId: u.sub, email: typeof u.email === 'string' ? u.email.slice(0, 254) : null, emailVerified: u.email_verified === true,
      login: null, name: typeof u.name === 'string' ? u.name : null,
      avatarUrl: typeof u.picture === 'string' && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(u.picture) ? u.picture : null };
  } finally {
    if (provider === 'github') {
      providerHttp.revokeGithub(token).catch((e) => log('warn', 'github token revoke failed', { error: String((e as Error).message) }));
    }
  }
}

function finish(provider: Provider) {
  return safe(async (req: Request, res: Response) => {
    const fail = (reason: string, to = '/?auth=failed') => {
      log('warn', 'oauth failed', { requestId: res.locals.requestId, provider, reason });
      res.redirect(302, to);
    };
    res.clearCookie(STATE_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/api/auth' });
    if (!providerEnabled(provider)) return fail('provider not configured', '/?auth=unavailable');
    if (typeof req.query.error === 'string') return fail(`provider returned ${String(req.query.error).slice(0, 40)}`, '/?auth=cancelled');

    const raw = readCookie(req, STATE_COOKIE);
    if (!raw) return fail('state cookie missing (expired, or a different browser)');
    let st: StatePayload;
    try { st = jwt.verify(raw, config.jwtSecret, { algorithms: ['HS256'] }) as StatePayload; } catch { return fail('state cookie invalid or expired'); }
    const state = req.query.state, code = req.query.code;
    if (typeof state !== 'string' || !STATE_RE.test(state)) return fail('state parameter missing or malformed');
    if (st.provider !== provider || st.state !== state) return fail('state mismatch');
    if (typeof code !== 'string' || !CODE_RE.test(code)) return fail('code missing or malformed');

    const redirectUri = redirectFor(provider, req);
    if (!redirectUri) return fail('redirect uri not configured');
    let profile: ProviderProfile;
    try { profile = await profileFor(provider, code, st.verifier, redirectUri); }
    catch (e) { return fail(e instanceof ProviderError ? e.message : `exchange error: ${String((e as Error).message).slice(0, 80)}`); }

    // A link must finish in the same account that started it.
    let current: string | null = null;
    if (st.linkUser) {
      current = await sessionUserId(req);
      if (current !== st.linkUser) return fail('link session changed', '/settings?auth=failed');
    }
    const r = await tx((c) => resolveIdentity(c, profile, current, st.tz));
    if (r.outcome === 'CONFLICT') return fail('identity belongs to another account', current ? '/settings?auth=conflict' : '/?auth=conflict');
    if (!current) await issueSession(req, res, r.userId!);
    log('info', 'oauth success', { requestId: res.locals.requestId, provider, outcome: r.outcome, userId: r.userId });
    res.redirect(302, r.outcome === 'LINKED' ? '/settings?auth=linked' : r.outcome === 'CREATED' ? '/?welcome=1' : '/');
  });
}

for (const p of ['github', 'google'] as const) {
  oauthRouter.get(`/${p}/start`, startLimit, start(p));
  oauthRouter.get(`/${p}/callback`, callbackLimit, finish(p));
}
