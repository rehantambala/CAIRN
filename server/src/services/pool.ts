import { z } from 'zod';
import type { Db } from '../db/pool.js';

/**
 * Extends the problem pool from the platforms' own public problem lists, so that suggestions never run out
 * and every one links to a real problem. Codeforces uses its official interface; LeetCode uses the same public
 * GraphQL endpoint as its website. Failure leaves the existing pool untouched.
 */
export interface PoolRow { platform: 'codeforces' | 'leetcode'; externalId: string; title: string; url: string; difficulty: string; topic: string | null }

const cfSchema = z.object({
  status: z.literal('OK'),
  result: z.object({ problems: z.array(z.object({
    contestId: z.number().optional(), index: z.string(), name: z.string(), rating: z.number().optional(), tags: z.array(z.string()).optional(),
  })) }),
});

export function parseCodeforcesProblems(raw: unknown, max = 900): PoolRow[] {
  const r = cfSchema.parse(raw).result.problems
    .filter((p) => p.contestId !== undefined && p.rating !== undefined && p.rating >= 800 && p.rating <= 1900 && /^[A-D][12]?$/.test(p.index))
    .sort((a, b) => b.contestId! - a.contestId!)
    .slice(0, max);
  return r.map((p) => ({
    platform: 'codeforces', externalId: `${p.contestId}${p.index}`, title: p.name,
    url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`, difficulty: String(p.rating), topic: p.tags?.[0] ?? null,
  }));
}

const lcSchema = z.object({ data: z.object({ problemsetQuestionList: z.object({ questions: z.array(z.object({
  title: z.string(), titleSlug: z.string(), difficulty: z.string(), isPaidOnly: z.boolean(), topicTags: z.array(z.object({ name: z.string() })).optional(),
})) }) }) });

export function parseLeetCodeProblems(raw: unknown): PoolRow[] {
  return lcSchema.parse(raw).data.problemsetQuestionList.questions
    .filter((q) => !q.isPaidOnly)
    .map((q) => ({
      platform: 'leetcode', externalId: q.titleSlug, title: q.title, url: `https://leetcode.com/problems/${q.titleSlug}/`,
      difficulty: q.difficulty, topic: q.topicTags?.[0]?.name ?? null,
    }));
}

const LC_QUERY = `query vectorPool($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    questions: data { title titleSlug difficulty isPaidOnly topicTags { name } }
  }
}`;

export interface PoolFetchers { json: (url: string, init?: RequestInit) => Promise<unknown> }
const defaultFetchers: PoolFetchers = {
  json: async (url, init) => {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-tracker/1.0)', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  },
};

async function insert(db: Db, rows: PoolRow[]): Promise<number> {
  let added = 0;
  for (const p of rows) {
    const r = await db.query(
      `insert into problems(platform, external_problem_id, title, url, difficulty, topic) values ($1,$2,$3,$4,$5,$6)
       on conflict (platform, external_problem_id) do nothing returning id`,
      [p.platform, p.externalId, p.title, p.url, p.difficulty, p.topic],
    );
    if (r.rows[0]) added++;
  }
  return added;
}

/** Refreshes at most once every 20 hours. Each source fails independently. */
export async function refreshPool(db: Db, now = Date.now(), f: PoolFetchers = defaultFetchers, force = false) {
  const last = (await db.query(`select updated_at from kv where key='pool_refreshed'`)).rows[0]?.updated_at as Date | undefined;
  if (!force && last && now - last.getTime() < 20 * 3_600_000) return { skipped: true, added: 0, errors: [] as string[] };
  let added = 0;
  const errors: string[] = [];
  try { added += await insert(db, parseCodeforcesProblems(await f.json('https://codeforces.com/api/problemset.problems'))); }
  catch (e: any) { errors.push(`codeforces: ${e?.message ?? e}`); }
  try {
    const raw = await f.json('https://leetcode.com/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
      body: JSON.stringify({ query: LC_QUERY, variables: { categorySlug: '', skip: 0, limit: 800, filters: {} } }),
    });
    added += await insert(db, parseLeetCodeProblems(raw));
  } catch (e: any) { errors.push(`leetcode: ${e?.message ?? e}`); }
  if (errors.length < 2) {
    await db.query(`insert into kv(key, value, updated_at) values ('pool_refreshed', $1, $2) on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at`,
      [JSON.stringify({ added, errors }), new Date(now)]);
  }
  return { skipped: false, added, errors };
}
