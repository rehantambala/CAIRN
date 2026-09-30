import { z } from 'zod';
import type { NormalizedContest, NormalizedSubmission, PlatformAdapter, Profile, RatingPoint } from './types.js';

const API = 'https://codeforces.com/api';

const envelope = z.object({ status: z.string(), comment: z.string().optional(), result: z.unknown().optional() });

const submissionSchema = z.object({
  id: z.number(),
  contestId: z.number().optional(),
  creationTimeSeconds: z.number(),
  verdict: z.string().optional(),
  participantType: z.string().optional(),
  problem: z.object({
    contestId: z.number().optional(),
    index: z.string(),
    name: z.string(),
    rating: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

const contestSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  phase: z.string(),
  durationSeconds: z.number(),
  startTimeSeconds: z.number().optional(),
});

const ratingSchema = z.object({
  contestId: z.number(),
  contestName: z.string(),
  ratingUpdateTimeSeconds: z.number(),
  oldRating: z.number(),
  newRating: z.number(),
});

const userSchema = z.object({ handle: z.string(), rating: z.number().optional(), maxRating: z.number().optional() });

export type Fetcher = (url: string) => Promise<unknown>;

let lastCall = 0;
/** Codeforces asks for at most one request per two seconds. */
const defaultFetch: Fetcher = async (url) => {
  const wait = lastCall + 2100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'vector-personal/1.0' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok && res.status !== 400) throw new Error(`Codeforces HTTP ${res.status}`);
  return res.json();
};

export function normalizeSubmission(raw: z.infer<typeof submissionSchema>): NormalizedSubmission | null {
  const cid = raw.problem.contestId ?? raw.contestId;
  if (cid === undefined) return null; // gym/problemset entries without a contest id cannot be identified
  const externalProblemId = `${cid}${raw.problem.index}`;
  const accepted = raw.verdict === 'OK';
  return {
    externalSubmissionId: String(raw.id),
    externalProblemId,
    title: raw.problem.name,
    url: `https://codeforces.com/problemset/problem/${cid}/${raw.problem.index}`,
    difficulty: raw.problem.rating ? String(raw.problem.rating) : null,
    verdict: raw.verdict ?? 'UNKNOWN',
    submittedAt: new Date(raw.creationTimeSeconds * 1000),
    accepted,
    contestExternalId: raw.contestId !== undefined ? String(raw.contestId) : null,
    inContest: raw.participantType === 'CONTESTANT',
  };
}

export function normalizeContest(raw: z.infer<typeof contestSchema>): NormalizedContest | null {
  if (raw.startTimeSeconds === undefined) return null;
  const startAt = new Date(raw.startTimeSeconds * 1000);
  const endAt = new Date((raw.startTimeSeconds + raw.durationSeconds) * 1000);
  const phase = raw.phase === 'BEFORE' ? 'UPCOMING' : raw.phase === 'CODING' ? 'LIVE' : 'FINISHED';
  return {
    platform: 'codeforces', externalContestId: String(raw.id), title: raw.name, startAt, endAt,
    registrationUrl: `https://codeforces.com/contestRegistration/${raw.id}`,
    contestUrl: `https://codeforces.com/contest/${raw.id}`,
    rated: raw.type === 'CF', phase,
  };
}

export function createCodeforcesAdapter(fetchJson: Fetcher = defaultFetch): PlatformAdapter {
  async function call<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
    const env = envelope.parse(await fetchJson(`${API}/${path}`));
    if (env.status !== 'OK') throw new Error(`Codeforces: ${env.comment ?? 'request failed'}`);
    return schema.parse(env.result);
  }
  return {
    platform: 'codeforces',
    capability: 'AUTOMATIC',
    capabilityNote: 'Verified automatically through the official Codeforces interface: profile, submissions, rating history and contests.',
    sourceState: 'LIVE',
    async getProfile(handle): Promise<Profile> {
      const [u] = await call(`user.info?handles=${encodeURIComponent(handle)}`, z.array(userSchema));
      return { handle: u.handle, rating: u.rating ?? null, maxRating: u.maxRating ?? null };
    },
    async getStats(handle) {
      const p = await this.getProfile!(handle);
      return { rating: p.rating };
    },
    async getSubmissions(handle) {
      const rows = await call(`user.status?handle=${encodeURIComponent(handle)}&from=1&count=5000`, z.array(submissionSchema));
      return rows.map(normalizeSubmission).filter((x): x is NormalizedSubmission => x !== null);
    },
    async getContests() {
      const rows = await call('contest.list?gym=false', z.array(contestSchema));
      return rows.map(normalizeContest).filter((x): x is NormalizedContest => x !== null);
    },
    async getRatingHistory(handle): Promise<RatingPoint[]> {
      const rows = await call(`user.rating?handle=${encodeURIComponent(handle)}`, z.array(ratingSchema));
      return rows.map((r) => ({
        contestExternalId: String(r.contestId), contestName: r.contestName,
        oldRating: r.oldRating, newRating: r.newRating, at: new Date(r.ratingUpdateTimeSeconds * 1000),
      }));
    },
  };
}
