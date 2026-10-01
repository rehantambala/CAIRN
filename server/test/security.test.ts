import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { lockDownDataApi } from '../src/db/migrate.js';
import { ProviderError, providerHttp, redirectUriFor } from '../src/routes/oauth.js';
import { redact, securityHeaderValues } from '../src/routes/security.js';
import { ADAPTERS } from '../src/adapters/index.js';
import { USER_OWNED_TABLES } from '../src/services/account.js';
import { cleanTitle, safePlatformUrl, upsertContest } from '../src/services/contests.js';
import { withJobLock } from '../src/services/jobs.js';
import { deliverDue, scheduleAll, type Sender } from '../src/services/notify.js';
import { discoverContests, type ContestSource } from '../src/services/sync.js';
import { isAllowedPushEndpoint } from '../src/domain/pushEndpoint.js';
import { isStillRelevant } from '../src/domain/notifications.js';
import type { NormalizedContest } from '../src/adapters/types.js';
import { freshDb, pool, tx } from './db-helper.js';

/**
 * Security properties of CAIRN, tested through the real HTTP stack against a real PostgreSQL database.
 * Only the outside world (Google, GitHub, coding platforms, push services) is replaced.
 */

let server: Server;
let base = '';
let ownerId = '';
const SRC = join(__dirname, '..', 'src');
const WEB = join(__dirname, '..', '..', 'web', 'src');

// ---------- a cookie-keeping client; each gets its own client address so rate limits do not bleed between tests ----------
let ipSeq = 1;
function client(opts: { ip?: string; csrf?: boolean } = {}) {
  const ip = opts.ip ?? `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const jar = new Map<string, string>();
  const setCookies: string[] = [];
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      setCookies.push(c);
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || v === '') jar.delete(k); else jar.set(k, v);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar, setCookies, ip,
    async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: {
          cookie: cookie(), 'x-forwarded-for': ip,
          ...(opts.csrf === false ? {} : { 'x-cairn-request': '1' }),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      keep(res);
      const text = await res.text();
      let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      return { status: res.status, location: res.headers.get('location'), json, text, headers: res.headers };
    },
    get(p: string, h?: Record<string, string>) { return this.req('GET', p, undefined, h); },
    post(p: string, b: unknown = {}, h?: Record<string, string>) { return this.req('POST', p, b, h); },
    put(p: string, b: unknown, h?: Record<string, string>) { return this.req('PUT', p, b, h); },
    del(p: string, b?: unknown) { return this.req('DELETE', p, b); },
  };
}
type Client = ReturnType<typeof client>;

// ---------- fake identity providers, with single-use codes like the real ones ----------
interface FakeUser { provider: 'github' | 'google'; id: string | number; login?: string; email?: string; verified?: boolean; name?: string }
let nextUser: FakeUser | null = null;
let profileOverride: any = undefined;
let tokenOverride: any = undefined;
let lastTokenRequest: Record<string, string> = {};
const usedCodes = new Set<string>();
const issuedTokens: string[] = [];
const revoked: string[] = [];
providerHttp.postForm = async (_url, body) => {
  lastTokenRequest = body;
  if (tokenOverride !== undefined) return tokenOverride;
  if (usedCodes.has(body.code)) throw new ProviderError('token 200 bad_verification_code');
  usedCodes.add(body.code);
  const t = `gho_secret_${Math.random().toString(36).slice(2)}`;
  issuedTokens.push(t);
  return { access_token: t, token_type: 'bearer' };
};
providerHttp.getJson = async (url) => {
  if (profileOverride !== undefined) return profileOverride;
  const u = nextUser!;
  if (url.includes('github')) return { id: Number(u.id), login: u.login, name: u.name ?? u.login, email: u.email ?? null, avatar_url: 'https://avatars.githubusercontent.com/u/1' };
  return { sub: String(u.id), email: u.email, email_verified: u.verified ?? true, name: u.name ?? 'Person', picture: null };
};
providerHttp.revokeGithub = async (t) => { revoked.push(t); };

async function startFlow(c: Client, provider: 'github' | 'google', extra = '') {
  const s = await c.get(`/api/auth/${provider}/start?tz=Asia%2FKolkata${extra}`);
  expect(s.status).toBe(302);
  return { res: s, q: new URL(s.location!).searchParams };
}
let codeSeq = 0;
async function signIn(c: Client, u: FakeUser, opts: { link?: boolean } = {}) {
  nextUser = u;
  const { q } = await startFlow(c, u.provider, opts.link ? '&link=1' : '');
  return c.get(`/api/auth/${u.provider}/callback?code=c${++codeSeq}&state=${q.get('state')}`);
}
const sessionCookie = (c: Client) => c.jar.get('cairn_session');
const userCount = async () => (await pool.query('select count(*)::int n from users')).rows[0].n as number;
const me = async (c: Client) => (await c.get('/api/auth/me')).json;

beforeAll(async () => {
  Object.assign(config, { githubClientId: 'gh-id', githubClientSecret: 'gh-secret', googleClientId: 'g-id', googleClientSecret: 'g-secret', ownerGithub: '999' });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await pool.end(); });
beforeEach(async () => {
  ownerId = await freshDb();
  nextUser = null; profileOverride = undefined; tokenOverride = undefined;
});

// =====================================================================================================
describe('sessions', () => {
  it('are opaque random tokens; only a hash is stored; nothing personal is in the cookie', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 7001, login: 'opaque', email: 'o@example.com' });
    const token = sessionCookie(c)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);                         // 256 random bits
    const id = (await me(c)).id;
    expect(token).not.toContain(id);
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toMatch(/opaque|example|[0-9a-f]{8}-/);
    const rows = (await pool.query('select token_hash from sessions where user_id=$1', [id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cookie is HttpOnly, SameSite=Lax, path /, and Secure in production', async () => {
    const c = client();
    await signIn(c, { provider: 'google', id: 'g-cookie', email: 'c@example.com' });
    const set = c.setCookies.find((x) => x.startsWith('cairn_session='))!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Path=\//);
    expect(set).toMatch(/Max-Age=2592000/);                                 // 30 days

    const prod = config.isProd;
    try {
      config.isProd = true;
      const p = client();
      const r = await p.post('/api/auth/login', { email: 'test@cairn.local', password: 'test-password' }, { 'x-forwarded-proto': 'https' });
      expect(r.status).toBe(200);
      expect(p.setCookies.find((x) => x.startsWith('cairn_session='))).toMatch(/; Secure/);
    } finally { config.isProd = prod; }
  });

  it('sign-out invalidates the session on the server: replaying the old cookie fails', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 7002, login: 'leaver' });
    const stolen = sessionCookie(c)!;
    expect((await c.get('/api/overview')).status).toBe(200);
    await c.post('/api/auth/logout');
    const replay = client();
    replay.jar.set('cairn_session', stolen);
    expect((await replay.get('/api/overview')).status).toBe(401);
    expect((await pool.query('select count(*)::int n from sessions')).rows[0].n).toBe(0);
  });

  it('signing out everywhere ends every device; an expired session is refused', async () => {
    const laptop = client(), phone = client();
    await signIn(laptop, { provider: 'github', id: 7003, login: 'multi' });
    await signIn(phone, { provider: 'github', id: 7003, login: 'multi' });
    expect((await phone.get('/api/overview')).status).toBe(200);
    expect((await laptop.post('/api/auth/logout-all')).json.ended).toBe(2);
    expect((await phone.get('/api/overview')).status).toBe(401);

    await signIn(phone, { provider: 'github', id: 7003, login: 'multi' });
    await pool.query(`update sessions set expires_at = now() - interval '1 second'`);
    expect((await phone.get('/api/overview')).status).toBe(401);
  });

  it('prevents fixation: a cookie planted before sign-in is never adopted', async () => {
    const c = client();
    const planted = 'A'.repeat(43);
    c.jar.set('cairn_session', planted);
    await signIn(c, { provider: 'github', id: 7004, login: 'fixed' });
    expect(sessionCookie(c)).not.toBe(planted);
    const attacker = client();
    attacker.jar.set('cairn_session', planted);
    expect((await attacker.get('/api/overview')).status).toBe(401);
  });

  it('a forged or legacy signed token is not a session', async () => {
    const forged = jwt.sign({ sub: ownerId }, config.jwtSecret, { expiresIn: 3600 });
    for (const value of [forged, 'not-a-token', '', '%E0%A4%A']) {
      const c = client();
      c.jar.set('cairn_session', value);
      expect((await c.get('/api/settings')).status).toBe(401);
    }
  });
});

// =====================================================================================================
describe('CSRF, CORS and security headers', () => {
  it('refuses a state-changing request without the CAIRN header, from another origin, or marked cross-site', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 7101, login: 'victim' });
    const id = (await me(c)).id;
    const target = async () => (await pool.query('select target_score from users where id=$1', [id])).rows[0].target_score;

    const noHeader = client({ csrf: false });
    noHeader.jar.set('cairn_session', sessionCookie(c)!);
    expect((await noHeader.put('/api/settings', { targetScore: 1000 })).status).toBe(403);
    expect((await noHeader.post('/api/auth/logout')).status).toBe(403);
    expect((await c.put('/api/settings', { targetScore: 1000 }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.put('/api/settings', { targetScore: 1000 }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await target()).toBe(25000);                                    // none of the refused writes landed

    expect((await c.put('/api/settings', { targetScore: 26000 }, { origin: base, 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('CORS never allows an arbitrary origin, and never uses a wildcard', async () => {
    const evil = await fetch(`${base}/api/settings`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-cairn-request,content-type' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const prev = config.webOrigin;
    try {
      config.webOrigin = 'https://app.example';
      const ok = await fetch(`${base}/api/settings`, { method: 'OPTIONS', headers: { origin: 'https://app.example', 'access-control-request-method': 'PUT' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
      expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    } finally { config.webOrigin = prev; }
  });

  it('sends the security headers on every response, and no-store on the API', async () => {
    const r = await client().get('/api/auth/me');
    const csp = r.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(r.headers.get('permissions-policy')).toContain('camera=()');
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    const prod = securityHeaderValues(true);
    expect(prod['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(prod['Content-Security-Policy']).toContain('upgrade-insecure-requests');
  });

  it('redirects plain HTTP to HTTPS in production and refuses writes over it', async () => {
    const prod = config.isProd;
    try {
      config.isProd = true;
      const g = await client().get('/api/auth/me', { 'x-forwarded-proto': 'http' });
      expect(g.status).toBe(308);
      expect(g.location).toMatch(/^https:\/\//);
      expect((await client().post('/api/auth/login', { email: 'a@b.co', password: 'x' }, { 'x-forwarded-proto': 'http' })).status).toBe(403);
      expect((await client().get('/api/auth/me', { 'x-forwarded-proto': 'https' })).status).toBe(200);
      expect((await client().get('/api/health')).status).toBe(200);         // internal health check, no header
    } finally { config.isProd = prod; }
  });
});

// =====================================================================================================
describe('OAuth: GitHub and Google', () => {
  it('GitHub requests no scope, Google only identity; both use S256 PKCE and a fresh state', async () => {
    const c = client();
    const gh = (await startFlow(c, 'github')).q;
    expect(gh.get('scope')).toBeNull();
    expect(gh.get('code_challenge_method')).toBe('S256');
    expect(gh.get('state')).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const go = (await startFlow(c, 'google')).q;
    expect(go.get('scope')).toBe('openid email profile');
    expect(go.get('code_challenge_method')).toBe('S256');
    expect(go.get('state')).not.toBe(gh.get('state'));
    const stateCookie = c.setCookies.filter((x) => x.startsWith('cairn_oauth=')).at(-1)!;
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/SameSite=Lax/);
    expect(stateCookie).toMatch(/Path=\/api\/auth/);
    expect(stateCookie).toMatch(/Max-Age=600/);
  });

  it('the redirect URI comes only from configuration; a spoofed Host header cannot change it', async () => {
    const prev = config.publicUrl;
    try {
      config.publicUrl = 'https://cairn.example';
      const { q } = await startFlow(client(), 'github');
      expect(q.get('redirect_uri')).toBe('https://cairn.example/api/auth/github/callback');
      const spoof = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual', headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
      expect(new URL(spoof.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://cairn.example/api/auth/google/callback');
    } finally { config.publicUrl = prev; }

    const P = { isProd: true, publicUrl: '', explicit: '', devHost: 'http://evil.example' };
    expect(redirectUriFor('github', P)).toBeNull();                                         // production never trusts Host
    expect(redirectUriFor('github', { ...P, publicUrl: 'http://cairn.example' })).toBeNull(); // https only
    expect(redirectUriFor('github', { ...P, explicit: 'https://cairn.example/elsewhere' })).toBeNull();
    expect(redirectUriFor('github', { ...P, explicit: 'https://cairn.example/api/auth/github/callback?next=//evil' })).toBeNull();
    expect(redirectUriFor('google', { ...P, explicit: 'https://cairn.example/api/auth/github/callback' })).toBeNull();
    expect(redirectUriFor('github', { ...P, publicUrl: 'https://cairn.example' })).toBe('https://cairn.example/api/auth/github/callback');
  });

  for (const provider of ['github', 'google'] as const) {
    const user = (id: string): FakeUser => provider === 'github' ? { provider, id: Number(id), login: `u${id}` } : { provider, id: `g${id}`, email: `${id}@example.com` };

    it(`${provider}: sign-up, sign-out, sign-in returns to the same account by the stable provider id`, async () => {
      const c = client();
      expect((await signIn(c, user('8001'))).location).toBe('/?welcome=1');
      const id = (await me(c)).id;
      await c.post('/api/auth/logout');
      expect((await me(c)).authenticated).toBe(false);
      const renamed = provider === 'github' ? { ...user('8001'), login: 'renamed' } : { ...user('8001'), email: 'changed@example.com' };
      expect((await signIn(c, renamed)).location).toBe('/');
      expect((await me(c)).id).toBe(id);
      expect(await userCount()).toBe(2);
    });

    it(`${provider}: every malformed callback is refused and creates no session or account`, async () => {
      const before = await userCount();
      const cases: [string, (c: Client, state: string) => Promise<{ location: string | null }>, string][] = [
        ['missing code', (c, s) => c.get(`/api/auth/${provider}/callback?state=${s}`), '/?auth=failed'],
        ['missing state', (c) => c.get(`/api/auth/${provider}/callback?code=x1`), '/?auth=failed'],
        ['incorrect state', (c) => c.get(`/api/auth/${provider}/callback?code=x2&state=${'A'.repeat(24)}`), '/?auth=failed'],
        ['malformed state', (c) => c.get(`/api/auth/${provider}/callback?code=x3&state=%27%20OR%201%3D1--`), '/?auth=failed'],
        ['malformed code', (c, s) => c.get(`/api/auth/${provider}/callback?code=%3Cscript%3E&state=${s}`), '/?auth=failed'],
        ['array parameters', (c, s) => c.get(`/api/auth/${provider}/callback?code=a&code=b&state=${s}`), '/?auth=failed'],
        ['provider error', (c, s) => c.get(`/api/auth/${provider}/callback?error=access_denied&state=${s}`), '/?auth=cancelled'],
      ];
      for (const [name, run, to] of cases) {
        const c = client();
        nextUser = user('8100');
        const { q } = await startFlow(c, provider);
        const r = await run(c, q.get('state')!);
        expect(r.location, name).toBe(to);
        expect(sessionCookie(c), name).toBeUndefined();
      }
      // A callback from a browser that never started the flow (login CSRF): no state cookie.
      const victim = client();
      const attacker = client();
      const { q } = await startFlow(attacker, provider);
      expect((await victim.get(`/api/auth/${provider}/callback?code=x9&state=${q.get('state')}`)).location).toBe('/?auth=failed');
      expect(sessionCookie(victim)).toBeUndefined();
      expect(await userCount()).toBe(before);
    });

    it(`${provider}: expired or tampered state, reused code, provider errors and odd profiles are refused`, async () => {
      const before = await userCount();
      // Expired state cookie, otherwise correct.
      {
        const c = client();
        const { q } = await startFlow(c, provider);
        const decoded = jwt.decode(c.jar.get('cairn_oauth')!) as any;
        delete decoded.iat;
        const expired = jwt.sign({ ...decoded, exp: Math.floor(Date.now() / 1000) - 5 }, config.jwtSecret);
        c.jar.set('cairn_oauth', expired);
        expect((await c.get(`/api/auth/${provider}/callback?code=e1&state=${q.get('state')}`)).location).toBe('/?auth=failed');
      }
      // State cookie signed with another key.
      {
        const c = client();
        const { q } = await startFlow(c, provider);
        const decoded = jwt.decode(c.jar.get('cairn_oauth')!) as any;
        delete decoded.iat; delete decoded.exp;
        c.jar.set('cairn_oauth', jwt.sign(decoded, 'attacker-key', { expiresIn: 600 }));
        expect((await c.get(`/api/auth/${provider}/callback?code=e2&state=${q.get('state')}`)).location).toBe('/?auth=failed');
      }
      // A state minted for the other provider.
      {
        const c = client();
        const other = provider === 'github' ? 'google' : 'github';
        const { q } = await startFlow(c, other);
        expect((await c.get(`/api/auth/${provider}/callback?code=e3&state=${q.get('state')}`)).location).toBe('/?auth=failed');
      }
      // A reused authorisation code is rejected by the provider, and so by CAIRN.
      {
        nextUser = user('8200');
        const c1 = client();
        const { q: q1 } = await startFlow(c1, provider);
        expect((await c1.get(`/api/auth/${provider}/callback?code=reuse-${provider}&state=${q1.get('state')}`)).location).toBe('/?welcome=1');
        const c2 = client();
        const { q: q2 } = await startFlow(c2, provider);
        expect((await c2.get(`/api/auth/${provider}/callback?code=reuse-${provider}&state=${q2.get('state')}`)).location).toBe('/?auth=failed');
        expect(sessionCookie(c2)).toBeUndefined();
      }
      // The token endpoint answers with an error (GitHub does so with HTTP 200), or without a token.
      for (const t of [{ error: 'incorrect_client_credentials' }, {}, { access_token: 42 }]) {
        tokenOverride = t;
        const c = client();
        expect((await signIn(c, user('8300'))).location).toBe('/?auth=failed');
        expect(sessionCookie(c)).toBeUndefined();
      }
      tokenOverride = undefined;
      // Unexpected profile shapes from the provider.
      const odd = provider === 'github'
        ? [{}, { id: 'abc', login: 'x' }, { id: -1 }, { id: 1.5 }, null]
        : [{}, { sub: '' }, { sub: 12 }, { sub: 'a b' }, null];
      for (const p of odd) {
        profileOverride = p;
        const c = client();
        expect((await signIn(c, user('8400'))).location).toBe('/?auth=failed');
        expect(sessionCookie(c)).toBeUndefined();
      }
      profileOverride = undefined;
      expect(await userCount()).toBe(before + 1);                          // only the one genuine sign-up
    });
  }

  it('the provider access token is used once, revoked (GitHub), and never stored anywhere', async () => {
    issuedTokens.length = 0; revoked.length = 0;
    const c = client();
    await signIn(c, { provider: 'github', id: 8501, login: 'tokencheck' });
    await signIn(client(), { provider: 'google', id: 'g-8502', email: 't@example.com' });
    expect(issuedTokens).toHaveLength(2);
    expect(revoked).toContain(issuedTokens[0]);
    // Scan every text-like column of every table for either token.
    const cols = (await pool.query(`select table_name, column_name from information_schema.columns
      where table_schema='public' and data_type in ('text','character varying','jsonb','json')`)).rows;
    for (const { table_name, column_name } of cols) {
      for (const t of issuedTokens) {
        const n = (await pool.query(`select count(*)::int n from "${table_name}" where "${column_name}"::text like $1`, [`%${t}%`])).rows[0].n;
        expect(n, `${table_name}.${column_name}`).toBe(0);
      }
    }
  });

  it('linking requires a signed-in account and must finish in the account that started it', async () => {
    const before = await userCount();
    const anon = client();
    nextUser = { provider: 'google', id: 'g-link-0', email: 'l0@example.com' };
    const s = await anon.get('/api/auth/google/start?link=1');
    expect(s.location).toBe('/?auth=failed');
    expect(await userCount()).toBe(before);

    const A = client();
    await signIn(A, { provider: 'github', id: 8601, login: 'alice' });
    const aId = (await me(A)).id;
    nextUser = { provider: 'google', id: 'g-link-1', email: 'l1@example.com' };
    const { q } = await startFlow(A, 'google', '&link=1');
    // A different account is now signed in this browser before the callback lands.
    const bTmp = client();
    await signIn(bTmp, { provider: 'github', id: 8602, login: 'bob' });
    A.jar.set('cairn_session', sessionCookie(bTmp)!);
    expect((await A.get(`/api/auth/google/callback?code=lk1&state=${q.get('state')}`)).location).toBe('/settings?auth=failed');
    expect((await pool.query(`select count(*)::int n from auth_identities where provider_user_id='g-link-1'`)).rows[0].n).toBe(0);
    expect((await pool.query(`select provider from auth_identities where user_id=$1`, [aId])).rows.map((r) => r.provider)).toEqual(['github']);
  });
});

// =====================================================================================================
describe('account takeover resistance', () => {
  it('never merges accounts by email, login name or display name', async () => {
    // Someone signs in with Google using an address another member's GitHub profile shows.
    const A = client();
    await signIn(A, { provider: 'github', id: 9001, login: 'anna', email: 'anna@example.com', name: 'Anna' });
    const aId = (await me(A)).id;
    const X = client();
    await signIn(X, { provider: 'google', id: 'g-x', email: 'anna@example.com', name: 'Anna', verified: true });
    expect((await me(X)).id).not.toBe(aId);

    // The owner's address, but not verified by Google: a new account, never the owner's.
    const U = client();
    await signIn(U, { provider: 'google', id: 'g-unverified', email: 'test@cairn.local', verified: false });
    expect((await me(U)).id).not.toBe(ownerId);

    // The owner's GitHub *login* on a different GitHub id: not the owner (only the numeric id is trusted).
    const L = client();
    await signIn(L, { provider: 'github', id: 12345, login: 'owner-login' });
    expect((await me(L)).id).not.toBe(ownerId);

    // The configured numeric id does reach the owner.
    const O = client();
    await signIn(O, { provider: 'github', id: 999, login: 'whatever' });
    expect((await me(O)).id).toBe(ownerId);
  });

  it('claiming another member’s coding handle gives no access to that member’s account', async () => {
    const A = client(), B = client();
    await signIn(A, { provider: 'github', id: 9101, login: 'a' });
    await signIn(B, { provider: 'github', id: 9102, login: 'b' });
    await A.post('/api/profiles/hackerrank', { handle: 'shared_handle' });
    await A.post('/api/import', { platform: 'hackerrank', contribution: 500 });
    await B.post('/api/profiles/hackerrank', { handle: 'shared_handle' });
    const a = (await A.get('/api/score')).json, b = (await B.get('/api/score')).json;
    expect(a.overall).toBe(500);
    expect(b.overall).toBe(0);                                              // B gets nothing of A's
    expect((await A.get('/api/settings')).json.user.displayName).toBe('a');
  });
});

// =====================================================================================================
describe('authorisation: user isolation (IDOR)', () => {
  async function twoPeople() {
    const A = client(), B = client();
    await signIn(A, { provider: 'github', id: 9201, login: 'alpha-marker' });
    await signIn(B, { provider: 'google', id: 'g-beta', email: 'beta-marker@example.com', name: 'beta-marker' });
    const aId = (await me(A)).id, bId = (await me(B)).id;
    await A.post('/api/import', { platform: 'leetcode', problemsSolved: 111, rating: 1500, contests: 3 });
    await B.post('/api/import', { platform: 'codeforces', problemsSolved: 222, rating: 1300, contests: 5 });
    await A.post('/api/profiles/hackerrank', { handle: 'alpha_handle' });
    await B.post('/api/profiles/interviewbit', { handle: 'beta_handle' });
    await A.put('/api/settings', { targetScore: 31_000, timezone: 'Asia/Kolkata' });
    await B.put('/api/settings', { targetScore: 41_000, timezone: 'Europe/London', reminders: { enabled: true, h24: false, h1: true, m10: true } });
    await A.post('/api/refresh'); await B.post('/api/refresh');
    const { id: contestId } = await tx((c) => upsertContest(c, null, {
      platform: 'leetcode', externalContestId: 'iso-1', title: 'Weekly Iso', rated: true,
      startAt: new Date(Date.now() + 30 * 3_600_000), endAt: new Date(Date.now() + 32 * 3_600_000), source: 'leetcode',
    }));
    expect((await A.post(`/api/contests/${contestId}/commit`, {})).status).toBe(200);
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)`,
      [bId, 'https://fcm.googleapis.com/fcm/send/beta-device', 'B'.repeat(87), 'b'.repeat(22)]);
    return { A, B, aId, bId, contestId };
  }

  const READS = ['/api/overview', '/api/today', '/api/contests', '/api/problems', '/api/trajectory', '/api/awards', '/api/analytics',
    '/api/calendar', '/api/score', '/api/settings', '/api/notifications', '/api/account/export', '/api/auth/me', '/api/auth/identities', '/api/strategist'];

  it('every private endpoint refuses an anonymous request', async () => {
    const anon = client();
    for (const p of READS.filter((x) => x !== '/api/auth/me')) expect((await anon.get(p)).status, p).toBe(401);
    for (const [m, p] of [['POST', '/api/refresh'], ['PUT', '/api/settings'], ['POST', '/api/sync/codeforces'], ['POST', '/api/profiles/codeforces'],
      ['DELETE', '/api/account'], ['POST', '/api/push/subscribe'], ['POST', '/api/import'], ['GET', '/api/account/export']] as const) {
      expect((await anon.req(m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(401);
    }
  });

  it('A reads only A’s data and B only B’s, on every endpoint', async () => {
    const { A, B, aId, bId } = await twoPeople();
    const today = new Date().toISOString().slice(0, 10);
    for (const p of [...READS, `/api/calendar/${today}`]) {
      const a = await A.get(p), b = await B.get(p);
      expect(a.status, p).toBe(200);
      expect(b.status, p).toBe(200);
      for (const leak of ['beta-marker', 'beta_handle', bId]) expect(a.text.includes(leak), `${p} leaks ${leak} to A`).toBe(false);
      for (const leak of ['alpha-marker', 'alpha_handle', aId]) expect(b.text.includes(leak), `${p} leaks ${leak} to B`).toBe(false);
    }
    // Figures, compared structurally (numbers could appear by coincidence inside timestamps).
    const [sa, sb] = [(await A.get('/api/score')).json, (await B.get('/api/score')).json];
    expect(sa.components.find((x: any) => x.platform === 'leetcode').problems).toBe(111);
    expect(sa.components.find((x: any) => x.platform === 'codeforces').problems).toBe(0);
    expect(sb.components.find((x: any) => x.platform === 'codeforces').problems).toBe(222);
    expect(sb.components.find((x: any) => x.platform === 'leetcode').problems).toBe(0);
    expect([sa.target, sb.target]).toEqual([31_000, 41_000]);
    const [ea, eb] = [(await A.get('/api/account/export')).json, (await B.get('/api/account/export')).json];
    expect(ea.profile.id).toBe(aId);
    expect(eb.profile.id).toBe(bId);
    expect([ea.profile.timezone, eb.profile.timezone]).toEqual(['Asia/Kolkata', 'Europe/London']);
    expect([ea.contestCommitments.length, eb.contestCommitments.length]).toEqual([1, 0]);
  });

  it('another person’s ids in paths or bodies change nothing', async () => {
    const { A, B, aId, bId, contestId } = await twoPeople();
    // B withdraws "A's" commitment: only B's own (absent) commitment is affected.
    expect((await B.del(`/api/contests/${contestId}/commit`)).status).toBe(200);
    expect((await pool.query('select count(*)::int n from contest_commitments where user_id=$1', [aId])).rows[0].n).toBe(1);
    // User ids where a date or contest id belongs.
    expect((await B.get(`/api/calendar/${aId}`)).status).toBe(400);
    expect((await B.post(`/api/contests/${aId}/commit`, {})).status).toBe(404);
    // Ownership fields in a body are rejected, not applied.
    expect((await B.put('/api/settings', { userId: aId, targetScore: 1000 })).status).toBe(400);
    expect((await B.post('/api/import', { platform: 'leetcode', problemsSolved: 1, userId: aId })).status).toBe(400);
    expect((await pool.query('select target_score from users where id=$1', [aId])).rows[0].target_score).toBe(31_000);
    expect((await pool.query('select target_score from users where id=$1', [bId])).rows[0].target_score).toBe(41_000);
    // Disconnecting "A's" platform only touches B.
    await B.del('/api/profiles/hackerrank');
    expect((await pool.query(`select username from platform_accounts where user_id=$1 and platform='hackerrank'`, [aId])).rows[0].username).toBe('alpha_handle');
  });

  it('reminders go only to the person who wants them', async () => {
    const { aId, bId, contestId } = await twoPeople();
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)`,
      [aId, 'https://fcm.googleapis.com/fcm/send/alpha-device', 'A'.repeat(87), 'a'.repeat(22)]);
    const sent: string[] = [];
    const sender: Sender = async (t) => { sent.push(t.endpoint); };
    const start = (await pool.query('select start_at from contests where id=$1', [contestId])).rows[0].start_at.getTime();
    for (const at of [start - 24 * 3_600_000 + 60_000, start - 3_600_000, start - 600_000, start - 600_000]) {
      for (const u of [aId, bId]) {
        await tx((c) => scheduleAll(c, u, at));
        await tx((c) => deliverDue(c, u, at, sender));
      }
    }
    expect(sent.filter((e) => e.endsWith('alpha-device'))).toHaveLength(3);    // 24h, 1h, 10m, each once
    expect(sent.some((e) => e.endsWith('beta-device'))).toBe(false);           // B committed to nothing
  });

  it('export contains only the person’s own data and no secret', async () => {
    const { A, aId, bId } = await twoPeople();
    const r = await A.get('/api/account/export');
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="cairn-export-/);
    const text = r.text;
    expect(r.json.profile.id).toBe(aId);
    expect(r.json.codingProfiles.map((p: any) => p.username)).toContain('alpha_handle');
    for (const bad of [bId, 'beta', 'password_hash', 'token_hash', 'p256dh', 'gho_', '$2a$', '$2b$']) expect(text.includes(bad), bad).toBe(false);
  });

  it('deleting an account removes all of its data, ends its sessions, and leaves everyone and everything else intact', async () => {
    const { A, B, aId, bId } = await twoPeople();
    const globals = async () => (await pool.query(`select (select count(*) from contests)::int c, (select count(*) from problems)::int p`)).rows[0];
    const g0 = await globals();
    const stolen = sessionCookie(A)!;
    expect((await A.del('/api/account', { confirm: 'yes' })).status).toBe(400);   // explicit confirmation required
    expect((await A.del('/api/account', { confirm: 'DELETE' })).status).toBe(200);
    for (const t of [...USER_OWNED_TABLES, 'users']) {
      const col = t === 'users' ? 'id' : 'user_id';
      expect((await pool.query(`select count(*)::int n from ${t} where ${col}=$1`, [aId])).rows[0].n, t).toBe(0);
    }
    expect((await pool.query(`select count(*)::int n from kv where key like $1`, [`%${aId}%`])).rows[0].n).toBe(0);
    const replay = client(); replay.jar.set('cairn_session', stolen);
    expect((await replay.get('/api/overview')).status).toBe(401);
    expect(await globals()).toEqual(g0);
    expect((await B.get('/api/score')).json.overall).toBeGreaterThan(0);
    expect((await pool.query('select count(*)::int n from users where id=$1', [bId])).rows[0].n).toBe(1);
  });
});

// =====================================================================================================
describe('input validation, injection and XSS', () => {
  it('rejects mass assignment and unknown fields', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 9301, login: 'mass' });
    const id = (await me(c)).id;
    for (const body of [{ score: 999999 }, { isAdmin: true }, { userId: ownerId }, { targetScore: 30000, password_hash: 'x' }, { reminders: { enabled: true, h24: true, h1: true, m10: true, admin: true } }]) {
      expect((await c.put('/api/settings', body)).status).toBe(400);
    }
    expect((await c.post('/api/profiles/hackerrank', { handle: 'h', userId: ownerId })).status).toBe(400);
    expect((await c.post('/api/contests/00000000-0000-0000-0000-000000000000/commit', { prepMinutes: 10, userId: ownerId })).status).toBe(400);
    expect((await pool.query('select target_score from users where id=$1', [id])).rows[0].target_score).toBe(25_000);
  });

  it('treats SQL injection payloads as data or refuses them, and leaves the database intact', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 9302, login: 'sqli' });
    const id = (await me(c)).id;
    const n0 = await userCount();
    const payloads = ["'", '"', "' OR '1'='1", "'; drop table users; --", '%27%20OR%201%3D1', "1' UNION SELECT password_hash FROM users--"];
    for (const p of payloads) {
      expect((await c.put('/api/settings', { displayName: `x${p}` })).status).toBe(200);
      expect((await c.get('/api/settings')).json.user.displayName).toBe(`x${p}`);   // stored literally
      expect((await c.post('/api/profiles/codeforces', { handle: p })).status).toBe(400);
      expect((await c.get(`/api/calendar/${encodeURIComponent(`2026-01-01${p}`)}`)).status).toBe(400);
      expect((await c.get(`/api/calendar?month=${encodeURIComponent(`2026-01${p}`)}`)).status).toBe(400);
      expect((await c.post(`/api/sync/${encodeURIComponent(`codeforces${p}`)}`)).status).toBe(400);
      expect((await c.post(`/api/contests/${encodeURIComponent(`1${p}`)}/commit`, {})).status).toBe(400);
      expect([400, 401]).toContain((await client().post('/api/auth/login', { email: `a${p}@x.co`, password: p })).status);
    }
    expect(await userCount()).toBe(n0);
    expect((await pool.query('select count(*)::int n from users where id=$1', [ownerId])).rows[0].n).toBe(1);
    expect((await pool.query('select display_name from users where id=$1', [ownerId])).rows[0].display_name).not.toMatch(/x'/);
    void id;
  });

  it('refuses malformed, oversized and out-of-range input with generic errors', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 9303, login: 'sizes' });
    expect((await c.put('/api/settings', '{"targetScore": ')).json.error).toBe('INVALID_JSON');
    expect((await c.post('/api/profiles/discover', { text: 'x'.repeat(2_000_000) })).status).toBe(413);
    expect((await c.post('/api/profiles/discover', { text: 'x'.repeat(5001) })).status).toBe(400);
    expect((await c.put('/api/settings', { displayName: 'n'.repeat(61) })).status).toBe(400);
    expect((await c.put('/api/settings', { displayName: 'bad\u0000name' })).status).toBe(400);
    expect((await c.put('/api/settings', { targetScore: -1 })).status).toBe(400);
    expect((await c.put('/api/settings', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await c.put('/api/settings', { targetDate: '2026-13-45' })).status).toBe(400);
    expect((await c.put('/api/settings', { targetDate: '2026-02-30' })).status).toBe(400);
    expect((await c.get('/api/calendar/2026-02-30')).status).toBe(400);
    expect((await c.get('/api/calendar?month=1999-12')).status).toBe(400);
    expect((await c.put('/api/settings', { targetDate: '2027-02-28' })).status).toBe(200);
    expect((await c.post('/api/sync/myspace')).status).toBe(400);
    expect((await c.post('/api/contests/not-a-uuid/commit', {})).status).toBe(400);
    const r = await c.put('/api/settings', { targetScore: 'lots' });
    expect(r.json.error).toBe('INVALID_INPUT');
    expect(JSON.stringify(r.json)).not.toContain('lots');                      // values are never echoed back
  });

  it('stores hostile names as text and serves them only as JSON; drops dangerous links', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 9304, login: 'xss' });
    const evil = '<img src=x onerror=alert(1)>';
    expect((await c.put('/api/settings', { displayName: evil })).status).toBe(200);
    const r = await c.get('/api/settings');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(r.json.user.displayName).toBe(evil);

    expect(safePlatformUrl('codeforces', 'javascript:alert(1)')).toBeNull();
    expect(safePlatformUrl('codeforces', 'data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safePlatformUrl('codeforces', 'https://evil.example/contest/1')).toBeNull();
    expect(safePlatformUrl('codeforces', 'http://codeforces.com/contest/1')).toBeNull();
    expect(safePlatformUrl('codeforces', 'https://codeforces.com.evil.example/x')).toBeNull();
    expect(safePlatformUrl('codeforces', 'https://codeforces.com/contest/1')).toBe('https://codeforces.com/contest/1');
    expect(cleanTitle('Round‮1\u0000 <b>x</b>')).toBe('Round 1 <b>x</b>');
    const { id } = await tx((cl) => upsertContest(cl, null, {
      platform: 'hackerrank', externalContestId: 'evil', title: 'x', rated: true, source: 'clist',
      startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), registrationUrl: 'javascript:alert(document.cookie)', contestUrl: 'https://evil.example',
    }));
    const row = (await pool.query('select registration_url, contest_url from contests where id=$1', [id])).rows[0];
    expect(row).toEqual({ registration_url: null, contest_url: null });
  });

  it('the frontend renders no raw HTML and builds every external link through safeHref', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk(WEB);
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
      for (const m of s.matchAll(/href=\{([^}]*)\}/g)) {
        expect(m[1].startsWith('safeHref(') || m[1].startsWith('`/'), `${f}: href={${m[1]}}`).toBe(true);
      }
      expect(s, f).not.toMatch(/localStorage|sessionStorage/);                 // no tokens in web storage
    }
  });
});

// =====================================================================================================
describe('SSRF', () => {
  it('accepts push endpoints only on the browsers’ push services', async () => {
    const bad = ['http://169.254.169.254/latest/meta-data/', 'https://169.254.169.254/', 'https://localhost/push', 'https://127.0.0.1/x', 'https://[::1]/x',
      'https://10.0.0.5/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x',
      'https://user:pass@fcm.googleapis.com/x', 'http://fcm.googleapis.com/fcm/send/x', 'file:///etc/passwd', 'gopher://fcm.googleapis.com/x'];
    for (const u of bad) expect(isAllowedPushEndpoint(u), u).toBe(false);
    for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-bl2p.notify.windows.com/w/?token=abc']) {
      expect(isAllowedPushEndpoint(u), u).toBe(true);
    }
    const c = client();
    await signIn(c, { provider: 'github', id: 9401, login: 'ssrf' });
    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    expect((await c.post('/api/push/subscribe', { endpoint: 'http://169.254.169.254/latest/meta-data/', keys })).status).toBe(400);
    expect((await c.post('/api/push/subscribe', { endpoint: 'https://localhost:5432/', keys })).status).toBe(400);
    expect((await c.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/ok', expirationTime: null, keys })).status).toBe(200);
  });

  it('never sends to a stored endpoint that is not a push service, and removes it', async () => {
    const id = (await pool.query(`insert into users(display_name) values ('legacy') returning id`)).rows[0].id;
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,'http://169.254.169.254/latest','k','a')`, [id]);
    await pool.query(`insert into notifications(user_id, type, dedupe_key, scheduled_for) values ($1,'OBJECTIVE_COMPLETE','d1', now() - interval '1 minute')`, [id]);
    const sent: string[] = [];
    await tx((c) => deliverDue(c, id, Date.now(), async (t) => { sent.push(t.endpoint); }));
    expect(sent).toEqual([]);
    expect((await pool.query('select count(*)::int n from push_subscriptions where user_id=$1', [id])).rows[0].n).toBe(0);
  });

  it('the server fetches only from fixed platform hosts, never from a URL supplied in a request', () => {
    const allowed: Record<string, RegExp> = {
      'adapters/codeforces.ts': /codeforces\.com/, 'adapters/codechef.ts': /codechef\.com/, 'adapters/leetcode.ts': /leetcode\.com/,
      'adapters/contestfeeds.ts': /leetcode\.com|codechef\.com/, 'adapters/clist.ts': /clist\.by/, 'services/pool.ts': /leetcode\.com|codeforces\.com/,
      'services/accounts.ts': /api\.github\.com/, 'routes/oauth.ts': /github\.com|googleapis\.com|google\.com/,
      'services/strategist.ts': /api\.anthropic\.com/,
    };
    const walk = (d: string, out: string[] = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (f.endsWith('.ts')) out.push(p); } return out; };
    for (const f of walk(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (!/(?<![.\w])fetch\(/.test(s)) continue;
      const rel = f.slice(SRC.length + 1);
      expect(Object.keys(allowed), `unexpected outbound fetch in ${rel}`).toContain(rel);
      expect(s, rel).toMatch(allowed[rel]);
      expect(s, rel).not.toMatch(/fetch\([^)]*req\.(body|query|params)/);
    }
  });
});

// =====================================================================================================
describe('rate limiting and platform abuse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('limits sign-in attempts and OAuth starts per address', async () => {
    const c = client({ ip: '10.250.0.1' });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.post('/api/auth/login', { email: 'x@example.com', password: 'wrong' })).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    const o = client({ ip: '10.250.0.2' });
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await o.get('/api/auth/github/start')).status;
    expect(last).toBe(429);
  });

  it('ten simultaneous "synchronise now" clicks make one platform request; a repeat within a minute makes none', async () => {
    const c = client();
    await signIn(c, { provider: 'github', id: 9501, login: 'clicker' });
    const id = (await me(c)).id;
    await pool.query(`insert into platform_accounts(user_id, platform, username, connection_status, verified_at) values ($1,'codeforces','tourist','CONNECTED',now())`, [id]);
    const cf = ADAPTERS.codeforces;
    let calls = 0;
    (vi.spyOn(cf as any, 'getProfile') as any).mockImplementation(async (h: string) => { calls++; await new Promise((r) => setTimeout(r, 150)); return { handle: h, rating: 1500 } as any; });
    vi.spyOn(cf, 'getSubmissions' as any).mockResolvedValue([]);
    vi.spyOn(cf, 'getRatingHistory' as any).mockResolvedValue([]);
    vi.spyOn(cf, 'getContests' as any).mockResolvedValue([]);
    const results = await Promise.all(Array.from({ length: 10 }, () => c.post('/api/sync/codeforces')));
    expect(results.every((r) => r.status === 200 && r.json.ok)).toBe(true);
    expect(calls).toBe(1);
    const again = await c.post('/api/sync/codeforces');
    expect(again.json.message).toBe('RECENTLY_SYNCED');
    expect(calls).toBe(1);
  });

  it('background jobs need the secret, and only one run of a job proceeds at a time', async () => {
    const anon = client();
    expect((await anon.post('/api/jobs/notify')).status).toBe(401);
    expect((await anon.post('/api/jobs/notify', {}, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await anon.post('/api/jobs/notify', {}, { authorization: `Bearer ${config.cronSecret}x` })).status).toBe(401);
    expect((await anon.get('/api/jobs/notify')).status).toBe(401);                 // no GET route; never runs
    const ok = await anon.post('/api/jobs/unknown', {}, { authorization: `Bearer ${config.cronSecret}` });
    expect(ok.status).toBe(404);
    expect(ok.json.error).toBe('UNKNOWN_JOB');
    expect((await anon.post('/api/jobs/notify', {}, { authorization: `Bearer ${config.cronSecret}` })).status).toBe(200);

    let release!: () => void;
    const first = withJobLock('notify', () => new Promise<string>((r) => { release = () => r('ran'); }));
    await new Promise((r) => setTimeout(r, 50));
    const second = await withJobLock('notify', async () => 'ran twice');
    release();
    expect(await first).toBe('ran');
    expect(second).toEqual({ skipped: 'ALREADY_RUNNING' });
    expect(await withJobLock('notify', async () => 'ran again')).toBe('ran again');      // the lease is released
  });
});

// =====================================================================================================
describe('reminders under real-world conditions', () => {
  const H = 3_600_000, MIN = 60_000;
  async function committed(tz = 'Asia/Kolkata', start = Date.UTC(2026, 10, 3, 14, 30)) {
    const { id: cid } = await tx((c) => upsertContest(c, null, {
      platform: 'codeforces', externalContestId: `rw-${start}`, title: 'Round RW', rated: true, startAt: new Date(start), endAt: new Date(start + 2 * H), source: 'codeforces',
    }));
    const uid = (await pool.query(`insert into users(display_name, timezone) values ('rw', $1) returning id`, [tz])).rows[0].id as string;
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,'k','a')`, [uid, `https://fcm.googleapis.com/fcm/send/${uid}`]);
    await pool.query('insert into contest_commitments(user_id, contest_id) values ($1,$2)', [uid, cid]);
    await tx((c) => scheduleAll(c, uid, start - 3 * 86_400_000));
    return { uid, cid, start };
  }

  it('uses each person’s timezone', async () => {
    const start = Date.UTC(2026, 10, 3, 14, 30);
    const k = await committed('Asia/Kolkata', start);
    const sent: string[] = [];
    await tx((c) => deliverDue(c, k.uid, start - 24 * H + MIN, async (_t, p) => { sent.push(JSON.parse(p).body); }));
    expect(sent[0]).toMatch(/tomorrow at 20:00/);                              // 14:30Z in Kolkata
    expect(isStillRelevant('CONTEST_24H', { id: 'x', platform: 'codeforces', title: 't', startAt: start, endAt: start + H }, start - 11 * H)).toBe(false);
    expect(isStillRelevant('CONTEST_1H', { id: 'x', platform: 'codeforces', title: 't', startAt: start, endAt: start + H }, start - 19 * MIN)).toBe(false);
    expect(isStillRelevant('CONTEST_10M', { id: 'x', platform: 'codeforces', title: 't', startAt: start, endAt: start + H }, start - MIN)).toBe(true);
    await pool.query('delete from contests'); await pool.query('delete from notifications');
    const l = await committed('Europe/London', start);
    await tx((c) => deliverDue(c, l.uid, start - 24 * H + MIN, async (_t, p) => { sent.push(JSON.parse(p).body); }));
    expect(sent[1]).toMatch(/tomorrow at 14:30/);                              // GMT in November
  });

  it('a failed push is retried and then delivered exactly once', async () => {
    const { uid, start } = await committed();
    let fail = true;
    const sent: string[] = [];
    const sender: Sender = async (_t, p) => { if (fail) throw Object.assign(new Error('503'), { statusCode: 503 }); sent.push(JSON.parse(p).body); };
    const at = start - 60 * MIN;
    const first = await tx((c) => deliverDue(c, uid, at, sender));
    expect(first.failed).toBe(1);                                              // the 1h notice fails once
    expect(first.skipped).toBe(1);                                             // the 24h notice is too late to be useful
    fail = false;
    const r = await tx((c) => deliverDue(c, uid, at + 2 * MIN, sender));
    expect(r.delivered).toBe(1);                                               // the 1h notice
    expect((await tx((c) => deliverDue(c, uid, at + 3 * MIN, sender))).delivered).toBe(0);
    const s = (await pool.query(`select type, status from notifications where user_id=$1 and type in ('CONTEST_24H','CONTEST_1H') order by type`, [uid])).rows;
    expect(s).toEqual([{ type: 'CONTEST_1H', status: 'DELIVERED' }, { type: 'CONTEST_24H', status: 'SKIPPED' }]);   // 24h moment has passed: never sent stale
  });

  it('follows a contest that the platform moves later, rather than reminding early', async () => {
    const { uid, cid, start } = await committed();
    await pool.query('update contests set start_at = start_at + interval \'2 hours\', end_at = end_at + interval \'2 hours\' where id=$1', [cid]);
    const sent: string[] = [];
    const sender: Sender = async (_t, p) => { sent.push(JSON.parse(p).body); };
    expect((await tx((c) => deliverDue(c, uid, start - 60 * MIN, sender))).delivered).toBe(0);   // old 1h time: too early now
    const moved = start + 2 * H;
    expect((await tx((c) => deliverDue(c, uid, moved - 60 * MIN, sender))).delivered).toBe(1);
    expect(sent.at(-1)).toMatch(/about one hour/);
  });

  it('withdraws reminders for a contest that is cancelled, and hides it', async () => {
    const H2 = 2 * H;
    const mk = (id: string, inH: number): NormalizedContest => ({
      platform: 'codeforces', externalContestId: id, title: `Round ${id}`, startAt: new Date(Date.now() + inH * H), endAt: new Date(Date.now() + inH * H + H2),
      registrationUrl: null, contestUrl: null, rated: true, phase: 'UPCOMING',
    });
    let listing = [mk('c-1', 30), mk('c-2', 60)];
    const sources: ContestSource[] = [{ key: 'codeforces', platform: 'codeforces', fetch: async () => listing, complete: true }];
    await discoverContests(null, Date.now(), sources);
    const c = client();
    await signIn(c, { provider: 'github', id: 9601, login: 'cancel' });
    const uid = (await me(c)).id;
    const cid = (await pool.query(`select id from contests where external_contest_id='c-1'`)).rows[0].id;
    expect((await c.post(`/api/contests/${cid}/commit`, {})).status).toBe(200);
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,'k','a')`, [uid, `https://fcm.googleapis.com/fcm/send/${uid}`]);

    // A failed or empty listing cancels nothing.
    listing = [];
    await discoverContests(null, Date.now(), sources);
    expect((await pool.query(`select cancelled_at from contests where id=$1`, [cid])).rows[0].cancelled_at).toBeNull();

    listing = [mk('c-2', 60)];                                                  // c-1 vanished before starting
    await discoverContests(null, Date.now(), sources);
    expect((await c.get('/api/contests')).json.contests.some((x: any) => x.id === cid)).toBe(false);
    const sent: string[] = [];
    await tx((cl) => deliverDue(cl, uid, Date.now() + 30 * H - 9 * MIN, async (_t, p) => { sent.push(p); }));
    expect(sent).toEqual([]);
    const statuses = (await pool.query(`select distinct status, payload_json->>'reason' reason from notifications where user_id=$1 and type<>'CONTEST_CLOSED'`, [uid])).rows;
    expect(statuses).toEqual([{ status: 'SKIPPED', reason: 'CANCELLED' }]);

    listing = [mk('c-1', 30), mk('c-2', 60)];                                   // listed again: restored
    await discoverContests(null, Date.now(), sources);
    expect((await c.get('/api/contests')).json.contests.some((x: any) => x.id === cid)).toBe(true);
  });
});

// =====================================================================================================
describe('logging and errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never logs authorisation codes, tokens, cookies or secrets', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const) (vi.spyOn(console, m) as any).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    issuedTokens.length = 0;
    const c = client();
    nextUser = { provider: 'github', id: 9701, login: 'logcheck' };
    const { q } = await startFlow(c, 'github');
    await c.get(`/api/auth/github/callback?code=SUPERSECRETCODE123&state=${q.get('state')}`);
    await startFlow(c, 'github');
    await c.get('/api/auth/github/callback?code=ANOTHERSECRETCODE&state=WRONGSTATEWRONGSTATE1234');
    await client().post('/api/auth/login', { email: 'x@example.com', password: 'hunter2-password' });
    const all = lines.join('\n');
    expect(lines.some((l) => l.includes('"msg":"request"') && l.includes('"route":"/api/auth/github/callback"'))).toBe(true);
    expect(lines.some((l) => l.includes('"msg":"oauth failed"') && l.includes('state mismatch'))).toBe(true);
    for (const secret of ['SUPERSECRETCODE123', 'ANOTHERSECRETCODE', 'hunter2-password', issuedTokens[0], sessionCookie(c)!, 'gh-secret', config.jwtSecret]) {
      expect(all.includes(secret), `log contains ${secret}`).toBe(false);
    }
    expect(redact({ password: 'p', nested: { access_token: 't', ok: 1 }, authorization: 'Bearer x', list: [{ secret: 's' }] }))
      .toEqual({ password: '[redacted]', nested: { access_token: '[redacted]', ok: 1 }, authorization: '[redacted]', list: [{ secret: '[redacted]' }] });
  });

  it('answers an unexpected failure with a generic error and keeps the details server-side', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const c = client();
    await signIn(c, { provider: 'github', id: 9702, login: 'boom' });
    await pool.query('alter table awards rename to awards_hidden');                 // a real database failure
    try {
      const r = await c.get('/api/awards');
      expect(r.status).toBe(500);
      expect(Object.keys(r.json).sort()).toEqual(['error', 'requestId']);
      expect(r.text).not.toMatch(/awards|relation|select|postgres|\/home\/|\.ts/);
      expect(lines.some((l) => l.includes(r.json.requestId) && l.includes('relation'))).toBe(true);   // detail kept server-side
    } finally { await pool.query('alter table awards_hidden rename to awards'); }
  });
});

// =====================================================================================================
describe('database: the data API is locked down', () => {
  it('enables Row Level Security on every table, so API roles see and change nothing', async () => {
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$`);
    const r = await lockDownDataApi();
    expect(r.apiRoles.sort()).toEqual(['anon', 'authenticated']);
    const tables = (await pool.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r'`)).rows;
    expect(tables.length).toBeGreaterThan(15);
    for (const t of tables) expect(t.relrowsecurity, t.relname).toBe(true);

    // Even if a host re-grants table privileges to an API role (Supabase does so by default), RLS still denies every row.
    await pool.query('grant usage on schema public to anon');
    await pool.query('grant select, insert, update, delete on all tables in schema public to anon');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      for (const t of ['users', 'sessions', 'auth_identities', 'push_subscriptions', 'platform_accounts']) {
        expect((await c.query(`select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
      }
      await expect(c.query(`update users set target_score = 1`)).resolves.toMatchObject({ rowCount: 0 });
      await expect(c.query(`insert into users(display_name) values ('intruder')`)).rejects.toThrow(/row-level security/);
    } finally { await c.query('rollback'); c.release(); }
    await pool.query('revoke all on all tables in schema public from anon');
    // The server's own role is unaffected.
    expect((await pool.query('select count(*)::int n from users')).rows[0].n).toBeGreaterThan(0);
  });
});
