import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { LeaderboardFormatError, parseLeaderboardRow, type Cell } from '../src/domain/leaderboard.js';
import { computeScore } from '../src/domain/score.js';
import { createSession } from '../src/services/sessions.js';
import { LEADERBOARD_2026_10_02 } from './fixtures.js';
import { freshDb, pool } from './db-helper.js';

/** The two header rows of the real export (Scores sheet, 2 October 2026), and one row with a fictional identity. */
const H0: Cell[] = ['Rank(Global Rank)', 'Roll Number', 'Name', 'Color Targets Count', null, 'Is Active?', 'Branch', 'Username', 'HackerRank (HR)', null, null, 'Smart Interviews (SI)', null, 'LeetCode (LC)', null, null, null, null, null, 'InterviewBit (IB)', null, 'CodeChef (CC)', null, null, null, null, null, 'Codeforces (CF)', null, null, null, null, null, 'Total Contests', 'Overall Score', 'Internal Contest(s)', 'Bee Coins'];
const H1: Cell[] = [null, null, null, 'Red Flags', 'Orange Flags', null, null, null, 'Data Structures(DS)', 'Algorithms(ALGO)', 'Total(DS+ALGO)', 'Basic', 'Primary', 'Number of Problems Solved(LCPS)', 'Rating(LCR)', 'Number of Contests(LCNC)', 'Total(LCPS*10 + (LCR-1300)2/10 + LCNC*50)', 'Latest Contest', 'Latest Contest Rank', 'Score(IBS)', 'Total(IBS/5)', 'Number of Problems Solved(CCPS)', 'Rating(CCR)', 'Number of Contests(CCNC)', 'Total(CCPS*2 + (CCR-1200)2/10 + CCNC*50)', 'Latest Contest', 'Latest Contest Rank', 'Number of Problems Solved(CFPS)', 'Rating(CFR)', 'Number of Contests(CFNC)', 'Total(CFPS*2 + (CFR-800)2/10 + CFNC*50)', 'Latest Contest', 'Latest Contest Rank', null, null, 'Contest 1 | Date: 20-Aug-2026 | MaxScore: 500', null];
const ROW: Cell[] = ['123 (22271)', '24071A0000', 'Test Person', '5', '4', 'Yes', 'IT', 'Test_Person', '30', '96', '126', '2046', '6030', '74', '1395', '18', '2542', 'Biweekly Contest 192(26 Sep 2026)', '8008', '4540', '908', '128', '1153', '18', '1156', 'Starters 258 (Rated)(30 Sep 2026)', '12872', '10', '835', '5', '392', 'Codeforces Round 1122 (Div. 3)(21 Sep 2026)', '18373', '41', '13200', '230', '826'];

describe('leaderboard row', () => {
  it('reads every platform from its columns and reproduces the published total', () => {
    const r = parseLeaderboardRow(H0, H1, ROW);
    expect(r.figures).toEqual(LEADERBOARD_2026_10_02);
    expect(r.parts).toEqual({ hackerrankDs: 30, hackerrankAlgo: 96, smartBasic: 2046, smartPrimary: 6030, interviewbitScore: 4540 });
    expect(r.person).toEqual({ name: 'Test Person', roll: '24071A0000', username: 'Test_Person', rank: '123 (22271)' });
    expect(r.sheetOverall).toBe(13200);
    expect(computeScore(r.figures).overall).toBe(13200);
  });

  it('survives a leaderboard that inserts a new column', () => {
    const at = 13; // before the LeetCode group
    const ins = <T,>(a: T[], v: T) => [...a.slice(0, at), v, ...a.slice(at)];
    const r = parseLeaderboardRow(ins(H0, 'Streak'), ins(H1, null), ins(ROW, '99'));
    expect(r.figures).toEqual(LEADERBOARD_2026_10_02);
  });

  it('names the missing column instead of guessing', () => {
    const h1 = H1.map((c) => (c === 'Primary' ? 'Intermediate' : c));
    expect(() => parseLeaderboardRow(H0, h1, ROW)).toThrow(LeaderboardFormatError);
    expect(() => parseLeaderboardRow(H0, h1, ROW)).toThrow(/Smart Interviews Primary/);
    expect(() => parseLeaderboardRow([], [], [])).toThrow(/does not look like a Smart Interviews leaderboard export/);
  });

  it('refuses a value that is not a number, and keeps whole numbers', () => {
    const bad = ROW.map((c, i) => (i === 14 ? 'n/a' : c));
    expect(() => parseLeaderboardRow(H0, H1, bad)).toThrow(/LeetCode rating/);
    const comma = ROW.map((c, i) => (i === 11 ? '2,046' : c));
    expect(parseLeaderboardRow(H0, H1, comma).figures.smartinterviews).toBe(8076);
    const frac = ROW.map((c, i) => (i === 14 ? '1394.6' : c));
    expect(parseLeaderboardRow(H0, H1, frac).figures.leetcode.rating).toBe(1395);
  });

  it('counts a fifth of the InterviewBit score, rounded down', () => {
    expect(parseLeaderboardRow(H0, H1, ROW.map((c, i) => (i === 19 ? '4543' : c))).figures.interviewbit).toBe(908);
  });
});

describe('leaderboard import through the API', () => {
  let server: Server; let base = ''; let ownerId = '';
  beforeAll(() => { server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(async () => { server.close(); await pool.end(); });
  beforeEach(async () => { ownerId = await freshDb(); });

  const cookieFor = async (id: string) => `cairn_session=${(await createSession(pool, id)).token}`;
  const post = async (path: string, body: unknown, cookie?: string) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cairn-request': '1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const t = await res.text(); let json: any = null; try { json = JSON.parse(t); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const get = async (path: string, cookie: string) => {
    const res = await fetch(base + path, { headers: { cookie } }); return { status: res.status, json: await res.json() };
  };
  const payload = { header: [H0, H1], row: ROW, exportedOn: '2026-10-02' };

  it('requires sign-in', async () => {
    expect((await post('/api/leaderboard/preview', payload)).status).toBe(401);
    expect((await post('/api/leaderboard/apply', payload)).status).toBe(401);
  });

  it('previews without changing anything, then applies every platform so the score equals the row', async () => {
    const cookie = await cookieFor(ownerId);
    const before = (await get('/api/score', cookie)).json.overall;
    expect(before).toBe(12604);                                    // the development seed's older snapshot

    const prev = await post('/api/leaderboard/preview', payload, cookie);
    expect(prev.status).toBe(200);
    expect(prev.json.computedOverall).toBe(13200);
    expect(prev.json.sheetAgrees).toBe(true);
    expect(prev.json.currentOverall).toBe(12604);
    expect(prev.json.current.smartinterviews).toBe(7976);
    expect((await get('/api/score', cookie)).json.overall).toBe(12604);   // a preview writes nothing

    const done = await post('/api/leaderboard/apply', payload, cookie);
    expect(done.status).toBe(200);
    expect(done.json.overall).toBe(13200);
    const s = (await get('/api/score', cookie)).json;
    expect(s.overall).toBe(13200);
    expect(s.manual.find((m: any) => m.platform === 'smartinterviews').total).toBe(8076);
    expect(s.components.find((c: any) => c.platform === 'codechef').total).toBe(1156);
    expect(s.components.find((c: any) => c.platform === 'leetcode')).toMatchObject({ problems: 74, rating: 1395, contests: 18, total: 2542 });

    // Applying the same row again changes nothing.
    expect((await post('/api/leaderboard/apply', payload, cookie)).json.overall).toBe(13200);
    expect((await get('/api/score', cookie)).json.overall).toBe(13200);
  });

  it('flags a sheet whose own total disagrees with the formula', async () => {
    const cookie = await cookieFor(ownerId);
    const row = ROW.map((c, i) => (i === 34 ? '13300' : c));
    const r = await post('/api/leaderboard/preview', { ...payload, row }, cookie);
    expect(r.json.sheetAgrees).toBe(false);
    expect(r.json.sheetOverall).toBe(13300);
    expect(r.json.computedOverall).toBe(13200);
  });

  it('rejects a file that is not a leaderboard, and malformed bodies', async () => {
    const cookie = await cookieFor(ownerId);
    const notLb = await post('/api/leaderboard/apply', { header: [['a'], ['b']], row: ['1'] }, cookie);
    expect(notLb.status).toBe(422);
    expect(notLb.json.error).toBe('LEADERBOARD_FORMAT');
    expect((await get('/api/score', cookie)).json.overall).toBe(12604);   // nothing was applied
    expect((await post('/api/leaderboard/apply', { header: 'x', row: [] }, cookie)).status).toBe(400);
    expect((await post('/api/leaderboard/apply', { ...payload, extra: 1 }, cookie)).status).toBe(400);
    expect((await post('/api/leaderboard/apply', { ...payload, exportedOn: '2026-13-45' }, cookie)).status).toBe(400);
  });

  it('applies only to the signed-in person', async () => {
    const bob = (await pool.query(`insert into users(display_name, timezone) values ('Bob','UTC') returning id`)).rows[0].id as string;
    await post('/api/leaderboard/apply', payload, await cookieFor(bob));
    expect((await get('/api/score', await cookieFor(ownerId))).json.overall).toBe(12604);
    expect((await get('/api/score', await cookieFor(bob))).json.overall).toBe(13200);
  });
});
