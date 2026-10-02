import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { buildCalendar, escapeText, fold, icsUtc } from '../src/domain/ics.js';
import { goalReview, roundUp500 } from '../src/domain/goal.js';
import { computeScore } from '../src/domain/score.js';
import { upsertContest } from '../src/services/contests.js';
import { createSession } from '../src/services/sessions.js';
import { BASELINE, LEADERBOARD_2026_10_02 } from './fixtures.js';
import { freshDb, pool } from './db-helper.js';

// ---------------------------------------------------------------------------------------------------------
describe('leaderboard reconciliation (Smart Interviews sheet, 2 October 2026)', () => {
  it('reproduces the published row exactly: 13,200 and every platform total', () => {
    const s = computeScore(LEADERBOARD_2026_10_02);
    expect(s.leetcode.total).toBe(2542);
    expect(s.codechef.total).toBe(1156);      // rating 1153 is below the 1200 baseline: the rating term is zero
    expect(s.codeforces.total).toBe(392);
    expect(s.hackerrank).toBe(126);
    expect(s.smartinterviews).toBe(8076);
    expect(s.interviewbit).toBe(908);
    expect(s.overall).toBe(13200);
  });

  it('explains the older 12,604 figure: Smart Interviews 100 lower, and three platforms behind', () => {
    const old = computeScore(BASELINE).overall;
    const now = computeScore(LEADERBOARD_2026_10_02).overall;
    expect(now - old).toBe(596);
    expect(LEADERBOARD_2026_10_02.smartinterviews - BASELINE.smartinterviews).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('calendar file (iCalendar)', () => {
  const T = Date.UTC(2026, 9, 4, 14, 30, 0);
  const ev = (over = {}) => ({ uid: 'contest-1@cairn', start: T, end: T + 2 * 3_600_000, summary: 'Codeforces Round 1200', description: 'Rated contest.', url: 'https://codeforces.com/contests/1200', alarmsMinutes: [1440, 60, 10], ...over });

  it('writes UTC instants, CRLF line endings and a display alarm for each stage', () => {
    const out = buildCalendar([ev()], T - 86_400_000);
    expect(icsUtc(T)).toBe('20261004T143000Z');
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out).toContain('DTSTART:20261004T143000Z');
    expect(out).toContain('DTEND:20261004T163000Z');
    expect(out.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(out).toContain('TRIGGER:-PT1440M');
    expect(out).toContain('TRIGGER:-PT60M');
    expect(out).toContain('TRIGGER:-PT10M');
  });

  it('escapes text and folds long lines at 75 octets without splitting a character', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = fold('SUMMARY:' + 'é'.repeat(80));
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(long.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(long.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'é'.repeat(80));
  });

  it('refuses a non-http address and injected line breaks', () => {
    const bad = buildCalendar([ev({ url: 'javascript:alert(1)', summary: 'x\r\nBEGIN:VEVENT' })], T);
    expect(bad).not.toContain('javascript:');
    expect(bad.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);   // the break is escaped text, not structure
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('target reached', () => {
  const inputs = LEADERBOARD_2026_10_02;
  it('offers nothing before the target is reached', () => {
    const g = goalReview(inputs, 13200, 25000, ['leetcode', 'codechef', 'codeforces'], 20);
    expect(g.reached).toBe(false);
    expect(g.options).toEqual([]);
    expect(g.overshoot).toBe(0);
  });

  it('offers three options, each above the score, rounded to 500 and dated from the recent rate', () => {
    const g = goalReview(inputs, 25412, 25000, ['leetcode', 'codechef', 'codeforces'], 40);
    expect(g.reached).toBe(true);
    expect(g.overshoot).toBe(412);
    expect(g.options.map((o) => o.id)).toEqual(['consolidate', 'stretch', 'mastery']);
    for (const o of g.options) {
      expect(o.targetScore).toBeGreaterThan(25412);
      expect(o.targetScore % 500).toBe(0);
      expect(o.days).toBeGreaterThanOrEqual(30);
    }
    expect(g.options[0].targetScore).toBe(roundUp500(25412 * 1.1));
    expect(g.options[1].targetScore).toBeGreaterThan(g.options[0].targetScore);
  });

  it('ties the skill goal to the nearest rating milestone among connected platforms only', () => {
    const g = goalReview(inputs, 25412, 25000, ['codechef'], null);
    const m = g.options.find((o) => o.id === 'mastery')!;
    expect(m.title).toContain('CodeChef');
    expect(m.detail).toContain('1300');      // the rating term begins at 1200; the goal is 100 past it
    expect(goalReview(inputs, 25412, 25000, [], null).options.map((o) => o.id)).toEqual(['consolidate', 'stretch']);
  });

  it('uses fixed, bounded dates when there is no recent rate', () => {
    const g = goalReview(inputs, 25412, 25000, [], null);
    expect(g.options.map((o) => o.days)).toEqual([60, 150]);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('private calendar link and contest file', () => {
  let server: Server;
  let base = '';
  let ownerId = '';
  beforeAll(() => { server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(async () => { server.close(); await pool.end(); });
  beforeEach(async () => { ownerId = await freshDb(); });

  const as = async (userId: string) => `cairn_session=${(await createSession(pool, userId)).token}`;
  const call = async (method: string, path: string, cookie?: string) => {
    const res = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), 'x-cairn-request': '1' } });
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text(), headers: res.headers };
  };
  const contest = (over: Record<string, unknown> = {}) => upsertContest(pool, null, {
    platform: 'codeforces', externalContestId: `cf-${Math.random()}`, title: 'Round 1200 (Div. 2)',
    startAt: new Date(Date.now() + 3 * 86_400_000), endAt: new Date(Date.now() + 3 * 86_400_000 + 7_200_000),
    contestUrl: 'https://codeforces.com/contests/1200', rated: true, ...over,
  } as any);

  it('creates a link once, serves a calendar from it, and never stores the token itself', async () => {
    const cookie = await as(ownerId);
    const c = await contest();
    const made = JSON.parse((await call('POST', '/api/calendar-feed', cookie)).text);
    expect(made.url).toMatch(/\/api\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const path = new URL(made.url).pathname;
    const token = path.split('/').pop()!.replace('.ics', '');
    expect((await pool.query('select count(*)::int n from calendar_feeds where token_hash=$1', [token])).rows[0].n).toBe(0);

    const feed = await call('GET', path);                       // no cookie: the address alone authenticates
    expect(feed.status).toBe(200);
    expect(feed.type).toContain('text/calendar');
    expect(feed.text).toContain('Codeforces Round 1200 (Div. 2)');
    expect(feed.text).toContain(`UID:contest-${c.id}@cairn`);
    expect(feed.text).toContain('TRIGGER:-PT1440M');             // the 24-hour alert for a relevant rated contest
    expect(feed.text).not.toContain('TRIGGER:-PT10M');           // the nearer alerts belong to commitments
    expect(feed.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('adds every alert once the person commits, and follows the same scope as push reminders', async () => {
    const cookie = await as(ownerId);
    const c = await contest();
    const other = await contest({ platform: 'hackerrank', externalContestId: 'hr-1', title: 'HackerRank Cup', rated: true });
    await pool.query('delete from platform_stats where user_id=$1 and platform=$2', [ownerId, 'hackerrank']);
    await call('POST', `/api/contests/${c.id}/commit`, cookie);
    const path = new URL(JSON.parse((await call('POST', '/api/calendar-feed', cookie)).text).url).pathname;
    const feed = (await call('GET', path)).text;
    expect(feed).toContain('(committed)');
    expect(feed).toContain('TRIGGER:-PT60M');
    expect(feed).toContain('TRIGGER:-PT10M');
    expect(feed).not.toContain('HackerRank Cup');                // not committed, and not a platform the person connects
    expect(other.id).toBeTruthy();
  });

  it('refuses unknown, malformed and revoked links alike', async () => {
    const cookie = await as(ownerId);
    const path = new URL(JSON.parse((await call('POST', '/api/calendar-feed', cookie)).text).url).pathname;
    expect((await call('GET', path)).status).toBe(200);
    expect((await call('GET', '/api/feed/' + 'A'.repeat(43) + '.ics')).status).toBe(404);
    expect((await call('GET', '/api/feed/short.ics')).status).toBe(404);
    expect((await call('GET', '/api/feed/' + 'A'.repeat(43))).status).toBe(404);
    await call('DELETE', '/api/calendar-feed', cookie);
    expect((await call('GET', path)).status).toBe(404);
    expect(JSON.parse((await call('GET', '/api/calendar-feed', cookie)).text).enabled).toBe(false);
  });

  it('replaces the old link when a new one is made', async () => {
    const cookie = await as(ownerId);
    const first = new URL(JSON.parse((await call('POST', '/api/calendar-feed', cookie)).text).url).pathname;
    const second = new URL(JSON.parse((await call('POST', '/api/calendar-feed', cookie)).text).url).pathname;
    expect(first).not.toBe(second);
    expect((await call('GET', first)).status).toBe(404);
    expect((await call('GET', second)).status).toBe(200);
  });

  it('keeps each person to their own calendar', async () => {
    const owner = await as(ownerId);
    const bob = (await pool.query(`insert into users(display_name, timezone) values ('Bob','UTC') returning id`)).rows[0].id as string;
    const c = await contest();
    await call('POST', `/api/contests/${c.id}/commit`, owner);
    const bobPath = new URL(JSON.parse((await call('POST', '/api/calendar-feed', await as(bob))).text).url).pathname;
    const bobFeed = (await call('GET', bobPath)).text;
    expect(bobFeed).not.toContain('(committed)');                // the owner's commitment is not visible to Bob
    expect(bobFeed.match(/BEGIN:VEVENT/g) ?? []).toHaveLength(0); // Bob has no platforms and no commitments
  });

  it('serves a single contest as a download with every alert, for the signed-in person only', async () => {
    const c = await contest();
    expect((await call('GET', `/api/contests/${c.id}/ics`)).status).toBe(401);
    const ok = await call('GET', `/api/contests/${c.id}/ics`, await as(ownerId));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toContain('attachment');
    expect(ok.text.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect((await call('GET', '/api/contests/not-a-uuid/ics', await as(ownerId))).status).toBe(400);
    expect((await call('GET', '/api/contests/00000000-0000-4000-8000-000000000000/ics', await as(ownerId))).status).toBe(404);
  });

  it('puts the goal on the briefing only once the target is reached', async () => {
    const cookie = await as(ownerId);
    const before = JSON.parse((await call('GET', '/api/overview', cookie)).text);
    expect(before.goal.reached).toBe(false);
    await pool.query('update users set target_score=$2 where id=$1', [ownerId, 10000]);
    const after = JSON.parse((await call('GET', '/api/overview', cookie)).text);
    expect(after.goal.reached).toBe(true);
    expect(after.goal.options.length).toBeGreaterThanOrEqual(2);
  });
});
