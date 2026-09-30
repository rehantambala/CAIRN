// Display copy for the award keys defined server-side. Eligibility is computed on the server only.
export const AWARD_META: Record<string, { figure: string; unit: string; title: string }> = {
  days_7: { figure: '7', unit: 'verified days', title: 'A full week of showing up' },
  days_30: { figure: '30', unit: 'verified days', title: 'A month of showing up' },
  contests_10: { figure: '10', unit: 'rated contests', title: 'Ten times in the arena' },
  contests_25: { figure: '25', unit: 'rated contests', title: 'Twenty-five times in the arena' },
  lc_100: { figure: '100', unit: 'LeetCode problems', title: 'One hundred solved' },
  cc_100: { figure: '100', unit: 'CodeChef problems', title: 'One hundred solved' },
  cf_100: { figure: '100', unit: 'Codeforces problems', title: 'One hundred solved' },
  cc_1400: { figure: '1400', unit: 'CodeChef rating', title: 'Rating reached' },
  lc_1500: { figure: '1500', unit: 'LeetCode rating', title: 'Rating reached' },
  score_25k: { figure: '25K+', unit: 'score', title: 'The objective, reached' },
};
