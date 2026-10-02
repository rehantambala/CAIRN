import type { ScoreInputs } from './score.js';

/**
 * Reads one person's row from a Smart Interviews leaderboard export (the "Scores" sheet). Pure: no I/O.
 *
 * The export has two header rows. The first names the platform group once, at its first column ("LeetCode (LC)"),
 * and leaves the rest of the group blank; the second names each column ("Rating(LCR)"). Columns are found by
 * those names, never by position, so a leaderboard that adds or reorders columns still reads correctly, and a
 * sheet that lacks a needed column is refused with the column named rather than guessed at.
 */

export type Cell = string | number | null;

export class LeaderboardFormatError extends Error {}

export interface LeaderboardRow {
  person: { name: string; roll: string; username: string; rank: string };
  figures: ScoreInputs;
  /** The leaderboard's own overall figure for the row, when the sheet has one. */
  sheetOverall: number | null;
  /** The columns as published, so that the person can see exactly what was read. */
  parts: { hackerrankDs: number; hackerrankAlgo: number; smartBasic: number; smartPrimary: number; interviewbitScore: number };
}

const norm = (c: Cell) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

type Group = 'hr' | 'si' | 'lc' | 'ib' | 'cc' | 'cf' | 'overall' | null;
function groupOf(label: string): Group {
  const n = norm(label);
  if (n.endsWith('hr') && n.includes('hackerrank')) return 'hr';
  if (n.endsWith('si') && n.includes('smartinterviews')) return 'si';
  if (n.endsWith('lc') && n.includes('leetcode')) return 'lc';
  if (n.endsWith('ib') && n.includes('interviewbit')) return 'ib';
  if (n.endsWith('cc') && n.includes('codechef')) return 'cc';
  if (n.endsWith('cf') && n.includes('codeforces')) return 'cf';
  if (n === 'overallscore') return 'overall';
  return null;
}

function number(raw: Cell, what: string): number {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  const n = Number(s);
  if (s === '' || !Number.isFinite(n) || n < 0) throw new LeaderboardFormatError(`The value for ${what} is not a number: "${String(raw ?? '').slice(0, 30)}".`);
  return n;
}

export function parseLeaderboardRow(header0: Cell[], header1: Cell[], row: Cell[]): LeaderboardRow {
  // Fill the group label forward across its blank cells; a label that is not a platform ends the previous group.
  const width = Math.max(header0.length, header1.length, row.length);
  const group: Group[] = [];
  let current: Group = null;
  for (let i = 0; i < width; i++) {
    if (norm(header0[i] ?? null) !== '') current = groupOf(String(header0[i]));
    group.push(current);
  }

  const find = (g: Group, test: (sub: string) => boolean): number => {
    for (let i = 0; i < width; i++) if (group[i] === g && test(norm(header1[i] ?? null))) return i;
    return -1;
  };
  const need = (g: Group, test: (sub: string) => boolean, label: string): number => {
    const i = find(g, test);
    if (i < 0) throw new LeaderboardFormatError(`The column "${label}" was not found. This does not look like a Smart Interviews leaderboard export.`);
    return i;
  };
  const at = (i: number, what: string) => number(row[i] ?? null, what);

  const ds = need('hr', (s) => s.endsWith('ds'), 'HackerRank Data Structures');
  const algo = need('hr', (s) => s.endsWith('algo') && !s.startsWith('total'), 'HackerRank Algorithms');
  const basic = need('si', (s) => s === 'basic', 'Smart Interviews Basic');
  const primary = need('si', (s) => s === 'primary', 'Smart Interviews Primary');
  const ibScore = need('ib', (s) => s.endsWith('ibs'), 'InterviewBit Score');
  const rated = (g: 'lc' | 'cc' | 'cf', code: string, name: string) => ({
    problems: at(need(g, (s) => s.endsWith(`${code}ps`), `${name} problems solved`), `${name} problems solved`),
    rating: at(need(g, (s) => s.endsWith(`${code}r`), `${name} rating`), `${name} rating`),
    contests: at(need(g, (s) => s.endsWith(`${code}nc`), `${name} contests`), `${name} contests`),
  });

  const parts = {
    hackerrankDs: at(ds, 'HackerRank Data Structures'), hackerrankAlgo: at(algo, 'HackerRank Algorithms'),
    smartBasic: at(basic, 'Smart Interviews Basic'), smartPrimary: at(primary, 'Smart Interviews Primary'),
    interviewbitScore: at(ibScore, 'InterviewBit score'),
  };
  const figures: ScoreInputs = {
    leetcode: rated('lc', 'lc', 'LeetCode'),
    codechef: rated('cc', 'cc', 'CodeChef'),
    codeforces: rated('cf', 'cf', 'Codeforces'),
    hackerrank: parts.hackerrankDs + parts.hackerrankAlgo,
    smartinterviews: parts.smartBasic + parts.smartPrimary,
    interviewbit: Math.floor(parts.interviewbitScore / 5),
  };
  // Ratings are whole numbers on every platform's leaderboard; a fraction would only be a spreadsheet artefact.
  for (const p of ['leetcode', 'codechef', 'codeforces'] as const) {
    for (const k of ['problems', 'rating', 'contests'] as const) figures[p][k] = Math.round(figures[p][k]);
  }

  const identity = (test: (h: string) => boolean) => {
    const i = header0.findIndex((h) => test(norm(h)));
    return i < 0 ? '' : String(row[i] ?? '').trim().slice(0, 80);
  };
  const overallIdx = group.findIndex((g) => g === 'overall');
  const sheetOverall = overallIdx >= 0 && String(row[overallIdx] ?? '').trim() !== '' ? Number(String(row[overallIdx]).replace(/,/g, '')) : null;

  return {
    person: {
      name: identity((h) => h === 'name'),
      roll: identity((h) => h === 'rollnumber'),
      username: identity((h) => h === 'username'),
      rank: identity((h) => h.startsWith('rank')),
    },
    figures,
    sheetOverall: sheetOverall !== null && Number.isFinite(sheetOverall) ? sheetOverall : null,
    parts,
  };
}
