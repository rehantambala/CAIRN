export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

const FRIENDLY: Record<string, string> = {
  RATE_LIMITED: 'Too many requests. Please wait a little and try again.',
  INTERNAL: 'Something went wrong on the server. Nothing was changed; please try again.',
  CSRF_REJECTED: 'The request was refused. Please reload the page and try again.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // The marker header lets the server refuse cross-site writes (CSRF); browsers cannot add it to a forged form.
    headers: { 'X-CAIRN-Request': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: a proxy or host error page */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'ERROR', json?.message ?? FRIENDLY[json?.error] ?? `The request failed (${res.status}).`);
  return json as T;
}

export const get = <T,>(p: string) => request<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b: unknown) => request<T>('PUT', p, b);
export const del = <T,>(p: string, b?: unknown) => request<T>('DELETE', p, b);

/** Only http(s) links are ever rendered from data; anything else (javascript:, data:) becomes no link at all. */
export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try { const p = new URL(u, window.location.origin); return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : undefined; } catch { return undefined; }
}

export type Platform = 'leetcode' | 'codechef' | 'codeforces' | 'smartinterviews' | 'interviewbit' | 'hackerrank';
export type SourceState = 'LIVE' | 'SYNCED' | 'IMPORTED' | 'MANUAL' | 'STALE' | 'ERROR';
export type DayState = 'COMPLETE' | 'ACTIVE' | 'PARTIAL' | 'MISSED' | 'REST';

export type Connection = 'NOT_CONNECTED' | 'PENDING_VERIFICATION' | 'CONNECTED' | 'SYNCED' | 'STALE' | 'ERROR' | 'MANUAL' | 'UNAVAILABLE';
export interface Source {
  platform: Platform; label: string; status: SourceState; updatedAt: string | null; note: string | null;
  capability: 'AUTOMATIC' | 'IMPORT' | 'MANUAL'; capabilityNote: string; username: string | null;
  connection: Connection; verifiedAt: string | null; lastError: string | null; hasFigures: boolean;
  capabilities: { profile: boolean; submissions: boolean; rating: boolean; contests: boolean; contestParticipation: boolean };
}
export interface SourceHealth { platform: string; status: 'SYNCED' | 'STALE' | 'ERROR' | 'UNAVAILABLE'; lastOkAt: string | null; checkedAt: string; message: string | null }
export interface Advice { next: { action: string; why: string }; today: string[]; contestPriority: string | null; practicePriority: string | null; recovery: string | null }
export interface Strategist { status: 'OFF' | 'OK' | 'UNAVAILABLE'; advice: Advice | null; generatedAt: string | null; message: string | null }
export interface RatedComponent {
  platform: 'leetcode' | 'codechef' | 'codeforces'; label: string; total: number; problems: number; rating: number; contests: number;
  parts: { problems: number; rating: number; contests: number };
  marginal: { perProblem: number; perContest: number; ratingToThreshold: number; ratingPlus25: number; ratingPlus100: number };
  source: { status: SourceState; updatedAt: string | null; note: string | null };
}
export interface ManualComponent { platform: 'smartinterviews' | 'interviewbit' | 'hackerrank'; label: string; total: number; source: { status: SourceState; updatedAt: string | null; note: string | null } }
export interface ScoreInputs {
  leetcode: { problems: number; rating: number; contests: number };
  codechef: { problems: number; rating: number; contests: number };
  codeforces: { problems: number; rating: number; contests: number };
  hackerrank: number; smartinterviews: number; interviewbit: number;
}
export interface ScoreView { overall: number; components: RatedComponent[]; manual: ManualComponent[]; inputs: ScoreInputs }
export interface Trajectory {
  status: 'AHEAD' | 'ON PACE' | 'PACE DEFICIT' | 'INSUFFICIENT DATA'; current: number; target: number; remaining: number; reached: boolean;
  gain1: number | null; gain7: number | null; gain14: number | null; gain30: number | null; velocity: number | null; requiredVelocity: number | null;
  daysToTarget: number | null; projectedDate: string | null; historyDays: number; note: string;
}
export interface Suggestion { platform: Platform; externalId: string; title: string; url: string; difficulty: string | null; topic: string | null }
export interface Item {
  id: string; type: 'PROBLEM_QUOTA' | 'CONTEST' | 'CONTEST_PREP' | 'REST'; platform: Platform | null; contestId: string | null; title: string; reason: string;
  required: boolean; quota: number; completedCount: number; completed: boolean; verification: 'VERIFIED' | 'MANUAL' | 'PENDING';
  suggestions: Suggestion[]; practiceUrl: string | null; guidance: string | null; minutes: number; points: number;
}
export interface Objective { id: string; date: string; status: string; isRest: boolean; trajectoryStatus: string; targetScoreDelta: number; rationale: string[]; items: Item[] }
export interface Next { kind: string; label: string; title: string; detail: string; reason: string; target: string | null; href: string; startsInMs: number | null; contestId: string | null }
export interface Consistency { executionRate: number | null; weeklyCompletion: number | null; contestAttendance: number | null; plannedSessions: number; completedSessions: number; consecutiveComplete: number; bottleneck: { window: string; misses: number } | null; recommendation: string | null }
export interface ContestCand { id: string; platform: Platform; title: string; startAt: number; endAt: number; rated: boolean; committed: boolean; registrationUrl: string | null; contestUrl: string | null }
export interface BriefStep { platform: Platform | null; label: string; kind: 'PROBLEMS' | 'CONTEST'; remaining: number; points: number; minutes: number; scoreAfter: number; perHour: number }
export interface Brief {
  scoreNow: number; scoreAfter: number; gain: number; minutes: number; steps: BriefStep[];
  milestone: number | null; toMilestone: number | null; toMilestoneAfter: number | null;
  daysAtThisRate: number | null; dailyPoints: number; dayEndsAt: number; mostEfficient: { label: string; perHour: number } | null;
}
export interface ContestPlan {
  perContest: number; rating: number; ratingPlus25: number; attempt: number; warmupBeginsAt: number;
  warmup: { count: number; minutes: number; from: number; to: number; problems: Suggestion[] };
}
export interface Overview {
  brief: Brief;
  user: { displayName: string; timezone: string; targetScore: number; targetDate: string | null }; now: string; date: string;
  score: ScoreView; target: number; remaining: number; trajectory: Trajectory;
  milestones: { list: number[]; current: number; next: number | null };
  next: Next; today: Objective; changes: { at: string; text: string; type: string }[]; consistency: Consistency; awards: string[];
  sources: Source[]; upcomingContests: ContestCand[]; knownSources: Platform[];
  reachability: { current: number; projected: number; gained: number; gap: number; coveredShare: number; stillNeeded: number; fixedShareOfCurrent: number; targets: Partial<Record<'leetcode' | 'codechef' | 'codeforces', number>> };
}
export interface ContestRow {
  id: string; platform: Platform; label: string; title: string; startAt: string; endAt: string; registrationUrl: string | null; contestUrl: string | null;
  rated: boolean; committed: boolean; prepMinutes: number; attended: boolean; ratingDelta: number | null;
  state: 'UPCOMING' | 'STARTING_SOON' | 'LIVE' | 'FINISHED' | 'MISSED' | 'ATTENDED'; manualOk: boolean; plan: ContestPlan | null;
  source: string | null; lastVerifiedAt: string | null; reminders: { type: 'CONTEST_24H' | 'CONTEST_1H' | 'CONTEST_10M'; at: string; status: string }[];
}
