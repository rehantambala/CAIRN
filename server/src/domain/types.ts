export type Platform =
  | 'leetcode' | 'codechef' | 'codeforces'
  | 'smartinterviews' | 'interviewbit' | 'hackerrank';

export const RATED_PLATFORMS = ['leetcode', 'codechef', 'codeforces'] as const;
export type RatedPlatform = (typeof RATED_PLATFORMS)[number];
export const MANUAL_PLATFORMS = ['smartinterviews', 'interviewbit', 'hackerrank'] as const;
export const ALL_PLATFORMS: Platform[] = [...RATED_PLATFORMS, ...MANUAL_PLATFORMS];

export type SourceState = 'LIVE' | 'SYNCED' | 'IMPORTED' | 'MANUAL' | 'STALE' | 'ERROR';
export type TrajectoryStatus = 'AHEAD' | 'ON PACE' | 'PACE DEFICIT' | 'INSUFFICIENT DATA';
export type DayState = 'COMPLETE' | 'ACTIVE' | 'PARTIAL' | 'MISSED' | 'REST';
export type ContestState = 'UPCOMING' | 'STARTING_SOON' | 'LIVE' | 'FINISHED' | 'MISSED' | 'ATTENDED';
export type Verification = 'VERIFIED' | 'MANUAL' | 'PENDING';

export const PLATFORM_LABEL: Record<Platform, string> = {
  leetcode: 'LeetCode',
  codechef: 'CodeChef',
  codeforces: 'Codeforces',
  smartinterviews: 'Smart Interviews',
  interviewbit: 'InterviewBit',
  hackerrank: 'HackerRank',
};
