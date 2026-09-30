export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'ERROR', json?.message);
  return json as T;
}

export const get = <T,>(p: string) => request<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b: unknown) => request<T>('PUT', p, b);
export const del = <T,>(p: string) => request<T>('DELETE', p);

export type Platform = 'leetcode' | 'codechef' | 'codeforces' | 'smartinterviews' | 'interviewbit' | 'hackerrank';
export type SourceState = 'LIVE' | 'SYNCED' | 'IMPORTED' | 'MANUAL' | 'STALE' | 'ERROR';
export type DayState = 'COMPLETE' | 'ACTIVE' | 'PARTIAL' | 'MISSED' | 'REST';

export interface Source { platform: Platform; label: string; status: SourceState; updatedAt: string | null; note: string | null; capability: 'AUTOMATIC' | 'IMPORT' | 'MANUAL'; capabilityNote: string; username: string | null }
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
export interface Overview {
  user: { displayName: string; timezone: string; targetScore: number; targetDate: string | null }; now: string; date: string;
  score: ScoreView; target: number; remaining: number; trajectory: Trajectory;
  milestones: { list: number[]; current: number; next: number | null };
  next: Next; today: Objective; changes: { at: string; text: string; type: string }[]; consistency: Consistency; awards: string[];
  sources: Source[]; upcomingContests: ContestCand[];
  reachability: { current: number; projected: number; gained: number; gap: number; coveredShare: number; stillNeeded: number; fixedShareOfCurrent: number };
}
export interface ContestRow {
  id: string; platform: Platform; label: string; title: string; startAt: string; endAt: string; registrationUrl: string | null; contestUrl: string | null;
  rated: boolean; committed: boolean; prepMinutes: number; attended: boolean; ratingDelta: number | null;
  state: 'UPCOMING' | 'STARTING_SOON' | 'LIVE' | 'FINISHED' | 'MISSED' | 'ATTENDED'; manualOk: boolean;
}
