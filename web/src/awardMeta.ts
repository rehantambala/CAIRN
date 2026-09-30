// Display copy for the award keys defined server-side. Eligibility is computed on the server only.
export const AWARD_META: Record<string, { figure: string; unit: string; title: string }> = {
  days_7: { figure: '7', unit: 'DAYS', title: 'Verified execution' },
  days_30: { figure: '30', unit: 'DAYS', title: 'Verified execution' },
  contests_10: { figure: '10', unit: 'RATED', title: 'Contests attended' },
  contests_25: { figure: '25', unit: 'RATED', title: 'Contests attended' },
  lc_100: { figure: '100', unit: 'LEETCODE', title: 'Problems' },
  cc_100: { figure: '100', unit: 'CODECHEF', title: 'Problems' },
  cf_100: { figure: '100', unit: 'CODEFORCES', title: 'Problems' },
  cc_1400: { figure: '1400', unit: 'CODECHEF', title: 'Rating' },
  lc_1500: { figure: '1500', unit: 'LEETCODE', title: 'Rating' },
  score_25k: { figure: '25K+', unit: 'OBJECTIVE', title: 'Reached' },
};
