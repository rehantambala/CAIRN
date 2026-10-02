import type { ScoreInputs } from '../src/domain/score.js';

export const BASELINE: ScoreInputs = {
  leetcode: { problems: 72, rating: 1373, contests: 17 },
  codechef: { problems: 125, rating: 1135, contests: 17 },
  codeforces: { problems: 10, rating: 835, contests: 5 },
  hackerrank: 126, smartinterviews: 7976, interviewbit: 908,
};

/**
 * One row of the Smart Interviews leaderboard (the "Scores" sheet exported on 2 October 2026), taken as published.
 * Smart Interviews is Basic 2,046 + Primary 6,030; HackerRank is Data Structures 30 + Algorithms 96; InterviewBit is
 * its score of 4,540 divided by five. The sheet totals 13,200 and reproduces under the clamped formula.
 */
export const LEADERBOARD_2026_10_02: ScoreInputs = {
  leetcode: { problems: 74, rating: 1395, contests: 18 },
  codechef: { problems: 128, rating: 1153, contests: 18 },
  codeforces: { problems: 10, rating: 835, contests: 5 },
  hackerrank: 30 + 96, smartinterviews: 2046 + 6030, interviewbit: 4540 / 5,
};
