import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { providerHttp } from '../src/routes/oauth.js';
import { connectProfile, disconnectProfile } from '../src/services/accounts.js';
import { syncPlatform, discoverContests, type ContestSource } from '../src/services/sync.js';
import { upsertContest, contestState } from '../src/services/contests.js';
import { scheduleAll, deliverDue, type Sender } from '../src/services/notify.js';
import { loadScore } from '../src/services/state.js';
import { strategistFor, buildContext } from '../src/services/strategist.js';
import { ProfileNotFound, type PlatformAdapter, type NormalizedContest } from '../src/adapters/types.js';
import { freshDb, pool, tx } from './db-helper.js';

/**
 * End-to-end behaviour for several people at once, through the real HTTP API where it matters:
 * sign-in and linking, isolation, profile lifecycles, contest sources and the reminder chain.
 * Only the outside world (Google, GitHub, coding platforms, push service) is replaced.
 */

let server: Server;
let base = '';
let ownerId = '';

// ---------- a minimal cookie-keeping client ----------
function client() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || v === '') jar.delete(k); else jar.set(k, v);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    async req(method: string, path: string, body?: unknown) {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { cookie: cookie(), 'x-cairn-request': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      keep(res);
      const text = await res.text();
      let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* html or empty */ }
      return { status: res.status, location: res.headers.get('location'), json };
    },
    get(p: string) { return this.req('GET', p); },
    post(p: string, b: unknown = {}) { return this.req('POST', p, b); },
    put(p: string, b: unknown) { return this.req('PUT', p, b); },
    del(p: string) { return this.req('DELETE', p); },
  };
}
type Client = ReturnType<typeof client>;

// ---------- fake identity providers ----------
interface FakeUser { provider: 'github' | 'google'; id: string; login?: string; email?: string; verified?: boolean; name?: string }
let nextUser: FakeUser | null = null;
let lastTokenRequest: Record<string, string> = {};
providerHttp.postForm = async (_url, body) => { lastTokenRequest = body; return { access_token: `tok-${body.code}` }; };
providerHttp.revokeGithub = async () => {};
providerHttp.getJson = async (url) => {
  const u = nextUser!;
  if (url.includes('github')) return { id: Number(u.id), login: u.login, name: u.name ?? u.login, avatar_url: 'https://avatars.example/a.png' };
  return { sub: u.id, email: u.email, email_verified: u.verified ?? true, name: u.name ?? 'Person', picture: null };
};

async function oauth(c: Client, u: FakeUser, opts: { link?: boolean; tz?: string; tamper?: boolean } = {}) {
  nextUser = u;
  const start = await c.get(`/api/auth/${u.provider}/start?tz=${encodeURIComponent(opts.tz ?? 'Asia/Kolkata')}${opts.link ? '&link=1' : ''}`);
  expect(start.status).toBe(302);
  const q = new URL(start.location!).searchParams;
  const state = opts.tamper ? 'forged' : q.get('state')!;
  const done = await c.get(`/api/auth/${u.provider}/callback?code=c-${u.id}&state=${state}`);
  return { start: q, done };
}

beforeAll(async () => {
  Object.assign(config, {
    githubClientId: 'gh-id', githubClientSecret: 'gh-secret', googleClientId: 'g-id', googleClientSecret: 'g-secret', ownerGithub: '999',
  });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await pool.end(); });
beforeEach(async () => { ownerId = await freshDb(); });

const userCount = async () => (await pool.query('select count(*)::int n from users')).rows[0].n as number;

// =====================================================================================================
describe('authentication', () => {
  it('protects every user route when signed out', async () => {
    const c = client();
    for (const p of ['/api/overview', '/api/settings', '/api/contests', '/api/trajectory', '/api/strategist']) {
      expect((await c.get(p)).status).toBe(401);
    }
    expect((await c.get('/api/auth/me')).json).toEqual({ authenticated: false });
  });

  it('GitHub: sign-up creates a new account with its own id; sign-in returns to it; no duplicate', async () => {
    const c = client();
    const { start, done } = await oauth(c, { provider: 'github', id: '101', login: 'alice' }, { tz: 'Europe/London' });
    expect(start.get('scope')).toBeNull();                               // no scope: public profile only
    expect(start.get('code_challenge_method')).toBe('S256');
    // PKCE: the verifier sent to the token endpoint hashes to the challenge sent to the browser.
    expect(createHash('sha256').update(lastTokenRequest.code_verifier).digest('base64url')).toBe(start.get('code_challenge'));
    expect(done.location).toBe('/?welcome=1');
    const me = (await c.get('/api/auth/me')).json;
    expect(me.authenticated).toBe(true);
    expect(me.id).not.toBe(ownerId);
    expect((await pool.query('select timezone from users where id=$1', [me.id])).rows[0].timezone).toBe('Europe/London');

    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).json.authenticated).toBe(false);
    const again = await oauth(c, { provider: 'github', id: '101', login: 'alice-renamed' });
    expect(again.done.location).toBe('/');
    expect((await c.get('/api/auth/me')).json.id).toBe(me.id);           // same account, despite a new login name
    expect(await userCount()).toBe(2);
  });

  it('Google: sign-up, sign-out and sign-in', async () => {
    const c = client();
    expect((await oauth(c, { provider: 'google', id: 'g-1', email: 'bea@example.com' })).done.location).toBe('/?welcome=1');
    const id = (await c.get('/api/auth/me')).json.id;
    await c.post('/api/auth/logout');
    expect((await oauth(c, { provider: 'google', id: 'g-1', email: 'bea@example.com' })).done.location).toBe('/');
    expect((await c.get('/api/auth/me')).json.id).toBe(id);
  });

  it('links a second provider to the same account, and refuses an identity that belongs to someone else', async () => {
    const a = client(), b = client();
    await oauth(a, { provider: 'github', id: '201', login: 'ann' });
    await oauth(b, { provider: 'google', id: 'g-bob', email: 'bob@example.com' });
    const aId = (await a.get('/api/auth/me')).json.id;

    expect((await oauth(a, { provider: 'google', id: 'g-ann', email: 'ann@example.com' }, { link: true })).done.location).toBe('/settings?auth=linked');
    expect((await a.get('/api/auth/identities')).json.identities.map((i: any) => i.provider).sort()).toEqual(['github', 'google']);

    // Bob's Google identity cannot be attached to Ann.
    const r = await oauth(a, { provider: 'google', id: 'g-bob', email: 'bob@example.com' }, { link: true });
    expect(r.done.location).toBe('/settings?auth=conflict');
    expect((await a.get('/api/auth/me')).json.id).toBe(aId);
    expect((await pool.query(`select user_id from auth_identities where provider_user_id='g-bob'`)).rows[0].user_id).not.toBe(aId);

    // Ann can now sign in with either provider and reaches the same account.
    const fresh = client();
    await oauth(fresh, { provider: 'google', id: 'g-ann', email: 'ann@example.com' });
    expect((await fresh.get('/api/auth/me')).json.id).toBe(aId);
    expect(await userCount()).toBe(3);
  });

  it('attaches the existing owner on first GitHub sign-in instead of creating a duplicate', async () => {
    const c = client();
    expect((await oauth(c, { provider: 'github', id: '999', login: 'Owner-GH' })).done.location).toBe('/');
    expect((await c.get('/api/auth/me')).json.id).toBe(ownerId);
    expect(await userCount()).toBe(1);
  });

  it('rejects a forged state, an expired session, and removing the only sign-in method', async () => {
    const c = client();
    expect((await oauth(c, { provider: 'github', id: '301', login: 'x' }, { tamper: true })).done.location).toBe('/?auth=failed');
    expect(await userCount()).toBe(1);

    // A signed token with the owner's id is not a session: sessions are opaque and exist only server-side.
    const forged = jwt.sign({ sub: ownerId }, config.jwtSecret, { expiresIn: 3600 });
    const res = await fetch(`${base}/api/overview`, { headers: { cookie: `cairn_session=${forged}` } });
    expect(res.status).toBe(401);

    await oauth(c, { provider: 'github', id: '302', login: 'solo' });
    expect((await c.del('/api/auth/identities/github')).status).toBe(409);
  });
});

// =====================================================================================================
describe('user isolation', () => {
  async function signUp(id: string, name: string) {
    const c = client();
    await oauth(c, { provider: 'github', id, login: name });
    return c;
  }

  it('a new person sees their own empty state, never the existing owner’s', async () => {
    const c = await signUp('401', 'newcomer');
    await c.post('/api/refresh');
    const o = (await c.get('/api/overview')).json;
    expect(o.score.overall).toBe(0);
    expect(o.knownSources).toEqual([]);
    expect(o.today.items).toEqual([]);
    expect(o.user.displayName).toBe('newcomer');
    expect(o.target).toBe(25_000);                                         // default objective, stored per user
    const s = (await c.get('/api/settings')).json;
    expect(s.sources.every((x: any) => x.connection === 'NOT_CONNECTED' && x.username === null)).toBe(true);
  });

  it('A and B each see only their own score, trajectory, execution, profiles and reminders', async () => {
    const A = await signUp('501', 'alpha');
    const B = await signUp('502', 'beta');
    await A.post('/api/import', { platform: 'leetcode', problemsSolved: 100, rating: 1500, contests: 4 });
    await B.post('/api/import', { platform: 'codeforces', problemsSolved: 30, rating: 900, contests: 3 });
    await A.post('/api/profiles/hackerrank', { handle: 'alpha_hr' });
    await A.put('/api/settings', { targetScore: 30_000 });

    const a = (await A.get('/api/overview')).json, b = (await B.get('/api/overview')).json;
    expect(a.score.overall).toBe(Math.floor(100 * 10 + 200 ** 2 / 10 + 4 * 50));   // 5,200
    expect(b.score.overall).toBe(Math.floor(30 * 2 + 100 ** 2 / 10 + 3 * 50));     // 1,210 (three contests: the rating term counts)
    expect(a.target).toBe(30_000);
    expect(b.target).toBe(25_000);
    expect(a.milestones.list.at(-1)).toBe(30_000);

    // Execution: each person's plan uses only their own platforms.
    const plat = (o: any) => new Set(o.today.items.filter((i: any) => i.type === 'PROBLEM_QUOTA').map((i: any) => i.platform));
    expect([...plat(a)]).toEqual(['leetcode']);
    expect([...plat(b)]).toEqual(['codeforces']);

    // Trajectory history is per person.
    const ta = (await A.get('/api/trajectory')).json, tb = (await B.get('/api/trajectory')).json;
    expect(ta.series.at(-1).score).toBe(a.score.overall);
    expect(tb.series.at(-1).score).toBe(b.score.overall);

    // Profiles are per person.
    const hrA = (await A.get('/api/settings')).json.sources.find((s: any) => s.platform === 'hackerrank');
    const hrB = (await B.get('/api/settings')).json.sources.find((s: any) => s.platform === 'hackerrank');
    expect(hrA.username).toBe('alpha_hr');
    expect(hrB.username).toBeNull();

    // The owner's data is untouched.
    expect((await loadScore(pool, ownerId)).score.overall).toBe(12604);

    // Contests are shared; commitments and reminders are not.
    const { id } = await tx((c) => upsertContest(c, null, {
      platform: 'leetcode', externalContestId: 'weekly-iso', title: 'Weekly Contest', rated: true,
      startAt: new Date(Date.now() + 30 * 3_600_000), endAt: new Date(Date.now() + 31.5 * 3_600_000), source: 'leetcode',
    }));
    expect((await A.post(`/api/contests/${id}/commit`, {})).status).toBe(200);
    const ca = (await A.get('/api/contests')).json.contests.find((x: any) => x.id === id);
    const cb = (await B.get('/api/contests')).json.contests.find((x: any) => x.id === id);
    expect(ca.committed).toBe(true);
    expect(cb.committed).toBe(false);
    expect(ca.reminders.map((r: any) => r.type).sort()).toEqual(['CONTEST_10M', 'CONTEST_1H', 'CONTEST_24H']);
    expect(cb.reminders).toEqual([]);                                       // B has no LeetCode, so no notice either
  });

  it('identity always comes from the session: another user’s id in a path or body has no effect', async () => {
    const A = await signUp('601', 'a');
    const res = await A.get(`/api/calendar/${ownerId}`);
    expect(res.status).not.toBe(200);
    const s = (await A.get('/api/settings')).json;
    expect(s.user.displayName).toBe('a');
  });
});

// =====================================================================================================
describe('coding profiles: connect, verify, sync, disconnect, reconnect, failure', () => {
  function fakeAdapter(platform: 'leetcode' | 'codechef' | 'codeforces', state: { mode: 'ok' | 'missing' | 'down'; problems: number }): PlatformAdapter {
    return {
      platform, capability: 'AUTOMATIC', capabilityNote: '', sourceState: 'SYNCED',
      async getProfile(h) {
        if (state.mode === 'missing') throw new ProfileNotFound(platform, h);
        if (state.mode === 'down') throw new Error('HTTP 503');
        return { handle: h.toLowerCase(), rating: 1400, maxRating: 1400 };
      },
      async getTotals() {
        if (state.mode === 'down') throw new Error('HTTP 503');
        return { problems: state.problems, contests: 3, rating: 1400 };
      },
    };
  }

  for (const platform of ['leetcode', 'codechef', 'codeforces'] as const) {
    it(`${platform}: full lifecycle`, async () => {
      const uid = (await pool.query(`insert into users(display_name) values ('p') returning id`)).rows[0].id as string;
      const st = { mode: 'missing' as 'ok' | 'missing' | 'down', problems: 40 };
      const ad = fakeAdapter(platform, st);

      expect((await connectProfile(pool, uid, platform, 'Ghost', Date.now(), ad)).state).toBe('NOT_FOUND');
      expect((await pool.query('select 1 from platform_accounts where user_id=$1', [uid])).rowCount).toBe(0);   // nothing saved

      st.mode = 'down';
      expect((await connectProfile(pool, uid, platform, 'Real', Date.now(), ad)).state).toBe('PENDING');

      st.mode = 'ok';
      const ok = await connectProfile(pool, uid, platform, '@Real', Date.now(), ad);
      expect(ok.state).toBe('CONNECTED');
      expect(ok.handle).toBe('real');                                          // the platform's canonical handle
      expect(ok.report?.ok).toBe(true);
      const s1 = (await loadScore(pool, uid)).inputs[platform];
      expect(s1.problems).toBe(40);

      st.problems = 41;                                                         // a newly solved problem
      expect((await syncPlatform(uid, platform, Date.now(), ad)).ok).toBe(true);
      expect((await loadScore(pool, uid)).inputs[platform].problems).toBe(41);
      expect((await syncPlatform(uid, platform, Date.now(), ad)).ok).toBe(true);   // idempotent
      expect((await loadScore(pool, uid)).inputs[platform].problems).toBe(41);

      st.mode = 'down';                                                         // source failure keeps figures
      expect((await syncPlatform(uid, platform, Date.now(), ad)).ok).toBe(false);
      const after = (await loadScore(pool, uid)).stats.find((x) => x.platform === platform)!;
      expect(after.problems).toBe(41);
      expect(after.sourceStatus).toBe('ERROR');

      await disconnectProfile(pool, uid, platform);
      st.mode = 'ok';
      expect((await syncPlatform(uid, platform, Date.now(), ad)).ok).toBe(false);  // synchronisation stopped
      expect((await loadScore(pool, uid)).inputs[platform].problems).toBe(41);      // history kept

      expect((await connectProfile(pool, uid, platform, 'real', Date.now(), ad)).state).toBe('CONNECTED');   // reconnect
      st.problems = 43;
      expect((await syncPlatform(uid, platform, Date.now(), ad)).ok).toBe(true);
      expect((await loadScore(pool, uid)).inputs[platform].problems).toBe(43);
    });
  }

  for (const platform of ['hackerrank', 'interviewbit', 'smartinterviews'] as const) {
    it(`${platform}: handle recorded as manual, figures entered, disconnect keeps them`, async () => {
      const c = client();
      await oauth(c, { provider: 'github', id: `7${platform.length}`, login: platform });
      const r = await c.post(`/api/profiles/${platform}`, { handle: 'me_1' });
      expect(r.json.state).toBe('MANUAL');
      let s = (await c.get('/api/settings')).json.sources.find((x: any) => x.platform === platform);
      expect(s.connection).toBe('MANUAL');
      expect(s.username).toBe('me_1');
      expect(s.capability).toBe('MANUAL');
      await c.post('/api/import', { platform, contribution: 321 });
      expect((await c.get('/api/overview')).json.score.overall).toBe(321);
      await c.del(`/api/profiles/${platform}`);
      s = (await c.get('/api/settings')).json.sources.find((x: any) => x.platform === platform);
      expect(s.username).toBeNull();
      expect((await c.get('/api/overview')).json.score.overall).toBe(321);
    });
  }

  it('refuses invalid handles and reports unknown ones without saving them', async () => {
    const c = client();
    await oauth(c, { provider: 'github', id: '801', login: 'v' });
    expect((await c.post('/api/profiles/hackerrank', { handle: 'bad handle!' })).status).toBe(400);
  });
});

// =====================================================================================================
describe('contest engine', () => {
  const H = 3_600_000;
  const mk = (platform: any, id: string, inH: number): NormalizedContest => ({
    platform, externalContestId: id, title: `${platform} ${id}`, startAt: new Date(Date.now() + inH * H), endAt: new Date(Date.now() + (inH + 2) * H),
    registrationUrl: `https://example.org/${id}`, contestUrl: `https://example.org/${id}`, rated: true, phase: 'UPCOMING',
  });
  let fail = false;
  const sources = (): ContestSource[] => [
    { key: 'codeforces', platform: 'codeforces', fetch: async () => [mk('codeforces', '1', 10), mk('codeforces', '2', 50)] },
    { key: 'leetcode', platform: 'leetcode', fetch: async () => [mk('leetcode', 'weekly-1', 20)] },
    { key: 'codechef', platform: 'codechef', fetch: async () => { if (fail) throw new Error('HTTP 503'); return [mk('codechef', 'START1A', 30), mk('codechef', 'START1B', 30)]; } },
    { key: 'hackerrank', platform: 'hackerrank', fetch: null, reason: 'not permitted' },
    { key: 'smartinterviews', platform: 'smartinterviews', fetch: null, reason: 'no listing' },
  ];
  const count = async () => (await pool.query('select count(*)::int n from contests')).rows[0].n as number;
  const health = async (k: string) => (await pool.query('select status from source_health where key=$1', [`contests:${k}`])).rows[0]?.status;

  it('stores each contest once, keeps parallel division instances apart, and is idempotent', async () => {
    const before = await count();
    await discoverContests(null, Date.now(), sources());
    expect(await count()).toBe(before + 5);                                   // START1A and START1B are distinct
    await discoverContests(null, Date.now(), sources());
    expect(await count()).toBe(before + 5);
    expect(await health('codeforces')).toBe('SYNCED');
    expect(await health('hackerrank')).toBe('UNAVAILABLE');
    expect(await health('smartinterviews')).toBe('UNAVAILABLE');
  });

  it('one failing source keeps its last verified contests, is marked STALE, and does not affect the others', async () => {
    await discoverContests(null, Date.now(), sources());
    fail = true;
    const r = await discoverContests(null, Date.now(), sources());
    fail = false;
    expect(r.sources).toContain('codeforces');
    expect(r.errors.join()).toMatch(/codechef/);
    expect(await health('codechef')).toBe('STALE');
    expect((await pool.query(`select count(*)::int n from contests where platform='codechef'`)).rows[0].n).toBe(2);
    await discoverContests(null, Date.now(), sources());
    expect(await health('codechef')).toBe('SYNCED');
  });

  it('moves through upcoming, starting soon, live and finished; a new user sees public contests', async () => {
    const t = { startAt: 10 * H, endAt: 12 * H };
    expect(contestState(t, 0, false, false)).toBe('UPCOMING');
    expect(contestState(t, 9 * H, false, false)).toBe('STARTING_SOON');
    expect(contestState(t, 11 * H, false, false)).toBe('LIVE');
    expect(contestState(t, 13 * H, false, false)).toBe('FINISHED');
    expect(contestState(t, 13 * H, true, false)).toBe('MISSED');
    expect(contestState(t, 13 * H, true, true)).toBe('ATTENDED');

    await discoverContests(null, Date.now(), sources());
    const c = client();
    await oauth(c, { provider: 'github', id: '901', login: 'fresh' });
    const list = (await c.get('/api/contests')).json;
    expect(new Set(list.contests.map((x: any) => x.platform))).toEqual(new Set(['codeforces', 'leetcode', 'codechef']));
    expect(list.sources.find((s: any) => s.platform === 'hackerrank').status).toBe('UNAVAILABLE');
  });
});

// =====================================================================================================
describe('reminders: the complete chain', () => {
  const MIN = 60_000;
  async function person(tz: string) {
    const id = (await pool.query(`insert into users(display_name, timezone) values ('r', $1) returning id`, [tz])).rows[0].id as string;
    await pool.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ($1,$2,'k','a')`, [id, `https://fcm.googleapis.com/fcm/send/${id}`]);
    return id;
  }

  it('24h, 1h and 10m are created, picked up when due, delivered once each, and never resent', async () => {
    const start = Date.UTC(2026, 9, 10, 14, 5);                              // 19:35 in Kolkata
    const { id: cid } = await tx((c) => upsertContest(c, null, {
      platform: 'codeforces', externalContestId: 'r-1', title: 'Round 1', rated: true, startAt: new Date(start), endAt: new Date(start + 2 * 60 * MIN), source: 'codeforces',
    }));
    const a = await person('Asia/Kolkata');
    const b = await person('America/New_York');
    await pool.query('insert into contest_commitments(user_id, contest_id) values ($1,$2)', [a, cid]);

    const sent: { endpoint: string; body: string }[] = [];
    const sender: Sender = async (t, payload) => { sent.push({ endpoint: t.endpoint, body: JSON.parse(payload).body }); };

    const t0 = start - 3 * 86_400_000;
    await tx((c) => scheduleAll(c, a, t0));
    await tx((c) => scheduleAll(c, b, t0));
    const rows = (await pool.query(`select type, scheduled_for from notifications where user_id=$1 order by scheduled_for`, [a])).rows;
    expect(rows.map((r) => r.type)).toEqual(['CONTEST_24H', 'CONTEST_1H', 'CONTEST_10M', 'CONTEST_CLOSED']);
    // Stored in UTC: 1 hour before 14:05Z is 13:05Z, i.e. 18:35 in Kolkata.
    expect(rows[1].scheduled_for.toISOString()).toBe('2026-10-10T13:05:00.000Z');
    expect((await pool.query('select count(*)::int n from notifications where user_id=$1', [b])).rows[0].n).toBe(0);   // B not involved

    const deliver = (now: number) => tx((c) => deliverDue(c, a, now, sender));
    expect((await deliver(start - 25 * 60 * MIN)).delivered).toBe(0);       // nothing due yet
    expect((await deliver(start - 24 * 60 * MIN + MIN)).delivered).toBe(1);
    expect(sent.at(-1)!.body).toMatch(/begins tomorrow at 19:35/);           // the user's local time
    expect((await deliver(start - 60 * MIN)).delivered).toBe(1);
    expect((await deliver(start - 10 * MIN)).delivered).toBe(1);
    expect(sent.at(-1)!.body).toMatch(/about 10 minutes/);

    // Rerunning the worker, including two at once, sends nothing again.
    const again = await Promise.all([deliver(start - 9 * MIN), deliver(start - 9 * MIN)]);
    expect(again.reduce((n, r) => n + r.delivered, 0)).toBe(0);
    expect(sent.filter((s) => s.endpoint.endsWith(a))).toHaveLength(3);
    expect(sent.some((s) => s.endpoint.endsWith(b))).toBe(false);
    const status = (await pool.query(`select type, status, delivered_at from notifications where user_id=$1 and type<>'CONTEST_CLOSED'`, [a])).rows;
    expect(status.every((r) => r.status === 'DELIVERED' && r.delivered_at)).toBe(true);
  });

  it('follows preferences, and restores a withdrawn reminder when re-enabled', async () => {
    const start = Date.now() + 3 * 86_400_000;
    const { id: cid } = await tx((c) => upsertContest(c, null, {
      platform: 'codeforces', externalContestId: 'r-2', title: 'Round 2', rated: true, startAt: new Date(start), endAt: new Date(start + 7_200_000), source: 'codeforces',
    }));
    const c = client();
    await oauth(c, { provider: 'github', id: '1001', login: 'prefs' });
    await c.post('/api/import', { platform: 'codeforces', problemsSolved: 1 });
    await c.post(`/api/contests/${cid}/commit`, {});
    const uid = (await c.get('/api/auth/me')).json.id;
    const pending = async () => (await pool.query(`select type from notifications where user_id=$1 and status='PENDING' order by type`, [uid])).rows.map((r) => r.type);
    expect(await pending()).toEqual(['CONTEST_10M', 'CONTEST_1H', 'CONTEST_24H', 'CONTEST_CLOSED']);
    await c.put('/api/settings', { reminders: { enabled: true, h24: true, h1: false, m10: true } });
    expect(await pending()).toEqual(['CONTEST_10M', 'CONTEST_24H', 'CONTEST_CLOSED']);
    await c.put('/api/settings', { reminders: { enabled: true, h24: true, h1: true, m10: true } });
    await tx((cl) => scheduleAll(cl, uid, Date.now()));
    expect(await pending()).toEqual(['CONTEST_10M', 'CONTEST_1H', 'CONTEST_24H', 'CONTEST_CLOSED']);
  });
});

// =====================================================================================================
describe('strategist', () => {
  it('is off without a key; reads only the signed-in user; cannot change any figure; rejects malformed output', async () => {
    expect((await strategistFor(pool, ownerId, Date.now(), null)).status).toBe('OFF');

    const other = (await pool.query(`insert into users(display_name) values ('other') returning id`)).rows[0].id as string;
    await pool.query(`insert into platform_stats(user_id, platform, base_problems, base_contests, rating) values ($1,'codeforces',999,3,2000)`, [other]);

    let seen = '';
    const good = async (_s: string, u: string) => { seen = u; return JSON.stringify({ next: { action: 'Solve two LeetCode problems before 21:00.', why: 'They add 20 certain points.' }, today: ['LeetCode first.'], contestPriority: null, practicePriority: null, recovery: null }); };
    const before = (await loadScore(pool, ownerId)).score.overall;
    const r = await strategistFor(pool, ownerId, Date.now(), good);
    expect(r.status).toBe('OK');
    expect(r.advice?.next.action).toMatch(/LeetCode/);
    const ctx = JSON.parse(seen);
    expect(ctx.verified.currentScore).toBe(12604);
    expect(seen).not.toContain('999');                                       // nobody else's figures
    expect((await loadScore(pool, ownerId)).score.overall).toBe(before);    // advice changes nothing

    await pool.query('delete from strategist_notes');
    const bad = async () => 'I think you solved 40 problems.';
    expect((await strategistFor(pool, ownerId, Date.now(), bad)).status).toBe('UNAVAILABLE');
    expect((await buildContext(pool, other, Date.now())).currentScore).toBe(Math.floor(999 * 2 + 1200 ** 2 / 10 + 3 * 50));
  });
});
