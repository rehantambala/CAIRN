import { z } from 'zod';
import { config } from '../config.js';
import type { NormalizedContest } from './types.js';
import type { Platform } from '../domain/types.js';

// clist.by aggregates contests from many sites. It needs a free account's API key (CLIST_USERNAME / CLIST_API_KEY).
const HOSTS: Record<string, Platform> = {
  'leetcode.com': 'leetcode', 'codechef.com': 'codechef', 'hackerrank.com': 'hackerrank', 'codeforces.com': 'codeforces',
};

const schema = z.object({
  objects: z.array(z.object({
    id: z.number(), event: z.string(), href: z.string(), host: z.string(), start: z.string(), end: z.string(),
  })),
});

export function normalizeClist(raw: z.infer<typeof schema>['objects'][number]): NormalizedContest | null {
  const platform = HOSTS[raw.host];
  if (!platform || platform === 'codeforces') return null; // Codeforces comes from its official API
  const startAt = new Date(raw.start + 'Z'), endAt = new Date(raw.end + 'Z');
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return {
    platform, externalContestId: String(raw.id), title: raw.event, startAt, endAt,
    registrationUrl: raw.href, contestUrl: raw.href, rated: true, phase: 'UPCOMING',
  };
}

export const clistConfigured = () => !!(config.clistUser && config.clistKey);

export async function fetchClistContests(now = Date.now()): Promise<NormalizedContest[]> {
  if (!clistConfigured()) return [];
  const from = new Date(now - 6 * 3_600_000).toISOString().slice(0, 19);
  const url = `https://clist.by/api/v4/contest/?username=${encodeURIComponent(config.clistUser)}&api_key=${encodeURIComponent(config.clistKey)}` +
    `&resource=${Object.keys(HOSTS).filter((h) => h !== 'codeforces.com').join(',')}&end__gt=${from}&order_by=start&limit=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`clist HTTP ${res.status}`);
  const parsed = schema.parse(await res.json());
  return parsed.objects.map(normalizeClist).filter((x): x is NormalizedContest => x !== null);
}
