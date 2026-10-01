import { z } from 'zod';
import type { NormalizedContest } from './types.js';

/**
 * Upcoming contests read directly from each platform's own public listing, so no third-party key is needed.
 * Each parser is pure; the fetchers are thin.
 */
const UA = 'Mozilla/5.0 (compatible; cairn-personal)';

const lcSchema = z.object({ data: z.object({ topTwoContests: z.array(z.object({
  title: z.string(), titleSlug: z.string(), startTime: z.number(), duration: z.number(),
})) }) });

export function parseLeetCodeContests(raw: unknown): NormalizedContest[] {
  return lcSchema.parse(raw).data.topTwoContests.map((c) => {
    const url = `https://leetcode.com/contest/${c.titleSlug}/`;
    return {
      platform: 'leetcode' as const, externalContestId: c.titleSlug, title: c.title,
      startAt: new Date(c.startTime * 1000), endAt: new Date((c.startTime + c.duration) * 1000),
      registrationUrl: url, contestUrl: url, rated: true, phase: 'UPCOMING' as const,
    };
  });
}

const ccItem = z.object({ contest_code: z.string(), contest_name: z.string(), contest_start_date_iso: z.string(), contest_end_date_iso: z.string() });
const ccSchema = z.object({ future_contests: z.array(ccItem).default([]), present_contests: z.array(ccItem).default([]) });

export function parseCodeChefContests(raw: unknown): NormalizedContest[] {
  const r = ccSchema.parse(raw);
  return [...r.present_contests, ...r.future_contests].flatMap((c) => {
    const startAt = new Date(c.contest_start_date_iso), endAt = new Date(c.contest_end_date_iso);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return [];
    const url = `https://www.codechef.com/${encodeURIComponent(c.contest_code)}`;
    return [{
      platform: 'codechef' as const, externalContestId: c.contest_code, title: c.contest_name, startAt, endAt,
      registrationUrl: url, contestUrl: url, rated: /starters|cook-?off|lunchtime|long challenge|rated/i.test(c.contest_name), phase: 'UPCOMING' as const,
    }];
  });
}

export async function fetchLeetCodeContests(): Promise<NormalizedContest[]> {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, referer: 'https://leetcode.com/contest/' },
    body: JSON.stringify({ query: 'query { topTwoContests { title titleSlug startTime duration } }' }), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LeetCode HTTP ${res.status}`);
  return parseLeetCodeContests(await res.json());
}

export async function fetchCodeChefContests(): Promise<NormalizedContest[]> {
  const res = await fetch('https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all', {
    headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CodeChef HTTP ${res.status}`);
  return parseCodeChefContests(await res.json());
}
