export interface AwardMetrics {
  verifiedDays: number;
  ratedContests: number;
  problems: { leetcode: number; codechef: number; codeforces: number };
  ratings: { leetcode: number; codechef: number; codeforces: number };
  overall: number;
}

export interface AwardDefinition {
  key: string;
  figure: string;
  unit: string;
  title: string;
  label: string;
  test: (m: AwardMetrics) => boolean;
}

export const AWARD_DEFINITIONS: AwardDefinition[] = [
  { key: 'days_7', label: 'Seven verified days', figure: '7', unit: 'DAYS', title: 'Verified execution', test: (m) => m.verifiedDays >= 7 },
  { key: 'days_30', label: 'Thirty verified days', figure: '30', unit: 'DAYS', title: 'Verified execution', test: (m) => m.verifiedDays >= 30 },
  { key: 'contests_10', label: 'Ten rated contests attended', figure: '10', unit: 'RATED', title: 'Contests attended', test: (m) => m.ratedContests >= 10 },
  { key: 'contests_25', label: 'Twenty-five rated contests attended', figure: '25', unit: 'RATED', title: 'Contests attended', test: (m) => m.ratedContests >= 25 },
  { key: 'lc_100', label: 'One hundred LeetCode problems', figure: '100', unit: 'LEETCODE', title: 'Problems', test: (m) => m.problems.leetcode >= 100 },
  { key: 'cc_100', label: 'One hundred CodeChef problems', figure: '100', unit: 'CODECHEF', title: 'Problems', test: (m) => m.problems.codechef >= 100 },
  { key: 'cf_100', label: 'One hundred Codeforces problems', figure: '100', unit: 'CODEFORCES', title: 'Problems', test: (m) => m.problems.codeforces >= 100 },
  { key: 'cc_1400', label: 'A CodeChef rating of 1400', figure: '1400', unit: 'CODECHEF', title: 'Rating', test: (m) => m.ratings.codechef >= 1400 },
  { key: 'lc_1500', label: 'A LeetCode rating of 1500', figure: '1500', unit: 'LEETCODE', title: 'Rating', test: (m) => m.ratings.leetcode >= 1500 },
  { key: 'score_25k', label: 'The objective of 25,000', figure: '25K+', unit: 'OBJECTIVE', title: 'Reached', test: (m) => m.overall >= 25_000 },
];

export function eligibleAwards(m: AwardMetrics): string[] {
  return AWARD_DEFINITIONS.filter((a) => a.test(m)).map((a) => a.key);
}

/** Keys newly earned (not already held). Idempotent: rerunning yields []. */
export function newAwards(m: AwardMetrics, held: Iterable<string>): string[] {
  const have = new Set(held);
  return eligibleAwards(m).filter((k) => !have.has(k));
}
