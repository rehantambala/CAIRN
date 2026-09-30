// Display copy for the award keys defined server-side. Eligibility is computed on the server only.
export const AWARD_META: Record<string, { figure: string; unit: string; title: string }> = {
  days_7: { figure: '7', unit: 'verified days', title: 'Seven verified days' },
  days_30: { figure: '30', unit: 'verified days', title: 'Thirty verified days' },
  contests_10: { figure: '10', unit: 'rated contests', title: 'Ten rated contests attended' },
  contests_25: { figure: '25', unit: 'rated contests', title: 'Twenty-five rated contests attended' },
  lc_100: { figure: '100', unit: 'LeetCode problems', title: 'One hundred problems solved' },
  cc_100: { figure: '100', unit: 'CodeChef problems', title: 'One hundred problems solved' },
  cf_100: { figure: '100', unit: 'Codeforces problems', title: 'One hundred problems solved' },
  cc_1400: { figure: '1400', unit: 'CodeChef rating', title: 'A rating of 1400' },
  lc_1500: { figure: '1500', unit: 'LeetCode rating', title: 'A rating of 1500' },
  score_25k: { figure: '25K+', unit: 'score', title: 'The objective of 25,000' },
};
