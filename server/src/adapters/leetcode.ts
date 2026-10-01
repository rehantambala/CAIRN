import { z } from 'zod';
import type { NormalizedSubmission, PlatformAdapter, Profile, Totals } from './types.js';
import { ProfileNotFound } from './types.js';

const ENDPOINT = 'https://leetcode.com/graphql';

/**
 * LeetCode publishes no official API. This adapter reads the same public, unauthenticated
 * GraphQL endpoint that the profile page itself uses, for a single public handle. No credential
 * is sent or stored. If the response shape changes, validation fails and the stored figures are kept.
 */
const QUERY = `
query vectorProfile($username: String!) {
  matchedUser(username: $username) {
    username
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
  userContestRanking(username: $username) { attendedContestsCount rating }
  recentAcSubmissionList(username: $username, limit: 20) { id title titleSlug timestamp }
}`;

const payload = z.object({
  data: z.object({
    matchedUser: z.object({
      username: z.string(),
      submitStatsGlobal: z.object({ acSubmissionNum: z.array(z.object({ difficulty: z.string(), count: z.number() })) }),
    }).nullable(),
    userContestRanking: z.object({ attendedContestsCount: z.number(), rating: z.number() }).nullable().optional(),
    recentAcSubmissionList: z.array(z.object({ id: z.string(), title: z.string(), titleSlug: z.string(), timestamp: z.string() })).nullable().optional(),
  }),
});
type Parsed = z.infer<typeof payload>['data'];

export type GraphQL = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

const defaultPost: GraphQL = async (query, variables) => {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com', 'User-Agent': 'Mozilla/5.0 (compatible; personal-tracker/1.0)' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LeetCode HTTP ${res.status}`);
  return res.json();
};

export function parseLeetCode(raw: unknown): { handle: string; totals: Totals; recent: NormalizedSubmission[] } {
  const body = raw as { errors?: { message?: string }[] };
  const parsed = payload.safeParse(raw);
  if (!parsed.success) throw new Error(body?.errors?.[0]?.message ?? 'LeetCode returned an unrecognised response');
  const d: Parsed = parsed.data.data;
  if (!d.matchedUser) throw new ProfileNotFound('leetcode', '');
  const all = d.matchedUser.submitStatsGlobal.acSubmissionNum.find((x) => x.difficulty === 'All');
  if (!all) throw new Error('LeetCode: the solved total is missing from the response');
  const rk = d.userContestRanking ?? null;
  const recent: NormalizedSubmission[] = (d.recentAcSubmissionList ?? []).map((s) => ({
    externalSubmissionId: s.id,
    externalProblemId: s.titleSlug,
    title: s.title,
    url: `https://leetcode.com/problems/${s.titleSlug}/`,
    difficulty: null,
    verdict: 'OK',
    submittedAt: new Date(Number(s.timestamp) * 1000),
    accepted: true,
    contestExternalId: null,
    inContest: false,
  }));
  return {
    handle: d.matchedUser.username,
    totals: { problems: all.count, contests: rk?.attendedContestsCount ?? 0, rating: rk ? Math.round(rk.rating) : null },
    recent,
  };
}

export function createLeetCodeAdapter(post: GraphQL = defaultPost): PlatformAdapter {
  // One network request serves profile, totals and submissions within a single synchronisation.
  let memo: { handle: string; at: number; value: Promise<ReturnType<typeof parseLeetCode>> } | null = null;
  const load = (handle: string) => {
    if (memo && memo.handle === handle && Date.now() - memo.at < 30_000) return memo.value;
    const value = post(QUERY, { username: handle }).then(parseLeetCode);
    memo = { handle, at: Date.now(), value };
    value.catch(() => { if (memo?.value === value) memo = null; });
    return value;
  };
  return {
    platform: 'leetcode',
    capability: 'AUTOMATIC',
    capabilityNote: 'Read from your public LeetCode profile: problems solved, contest rating, contests attended and recent accepted submissions. LeetCode offers no official interface, so a change on their side can interrupt this; your stored figures are then kept and marked as an error.',
    sourceState: 'SYNCED',
    async getProfile(handle): Promise<Profile> {
      const r = await load(handle);
      return { handle: r.handle, rating: r.totals.rating, maxRating: null };
    },
    async getTotals(handle) { return (await load(handle)).totals; },
    async getSubmissions(handle) { return (await load(handle)).recent; },
  };
}
