# Where each figure comes from

Every figure CAIRN shows is read from a platform or entered by you. This page records, for each platform, what was
checked, what is used, and what is not. Findings dated 2 October 2026 were taken against one real profile and one real
leaderboard export; they describe those, not every account.

| Platform | Route used | Checked on 2 October 2026 |
| --- | --- | --- |
| Codeforces | Official API (`user.info`, `user.status`, `user.rating`, `contest.list`), read directly | Profile gave 10 distinct accepted problems, 5 rated contests, rating 835. The leaderboard row shows the same. |
| CodeChef | Public profile page, three labelled figures, read directly | Profile gave 128 problems, rating 1,153, 18 contests. The leaderboard row shows the same. |
| LeetCode | Public GraphQL endpoint that its own profile page uses (unofficial), read directly | Profile page shows 75 problems solved; the leaderboard row, refreshed earlier, shows 74. Rating and contests are not on the profile page, so they were not independently checked. |
| HackerRank | None. No public interface for the leaderboard's Data Structures and Algorithms columns | A page fetch of its profile data was refused as disallowed by `robots.txt`. Entered from the leaderboard export. |
| InterviewBit | None | A page fetch of the profile was refused as disallowed by `robots.txt`. Entered from the leaderboard export. |
| Smart Interviews | None. The leaderboard needs a sign-in, which CAIRN never automates | Entered from the leaderboard export. |

## Why the leaderboard export

Three of the six components cannot be read by any permissible route, and together they were about 9,000 of a 13,200
score. The leaderboard's own export (menu at the top right of the sheet) carries all six components for every
person. CAIRN reads it in the browser, sends only the person's own row, shows what would change, and sets every
figure only when the person applies it. The parser finds columns by name, so an export with extra or reordered
columns still reads correctly, and a missing column is reported by name.

## Community projects looked at

Search results for competitive-programming statistics APIs on GitHub include
[ravibabuvadde/competeapi](https://github.com/ravibabuvadde/competeapi) (CodeChef, Codeforces, LeetCode) and
[abhijeet-reddy/Competitive_Programming_Score_API](https://github.com/abhijeet-reddy/Competitive_Programming_Score_API)
(Codeforces, CodeChef, SPOJ, InterviewBit), and the GitHub topics for
[leetcode-api](https://github.com/topics/leetcode-api) and [codechef-api](https://github.com/topics/codechef-api).
Their descriptions were read; their code was not audited. They are not used, for three reasons: they read the same public
pages CAIRN already reads, so they add no figure that is otherwise unobtainable; a hosted instance would receive each
person's handles and become a further point of failure; and the platforms that cannot be read directly (HackerRank,
InterviewBit) are the ones whose pages disallow automated reading, which a wrapper would not change.

## Notes

- LeetCode's GraphQL endpoint is unofficial and was reported as disallowed by `robots.txt` by the fetch tool used in this review.
  CAIRN reads it only for the signed-in person's own public handle, on request and on a schedule of at most one reading per
  half hour, and the adapter can be switched off with `SOURCE_LEETCODE`. If you prefer not to use it, switch it off and enter the figures from the leaderboard export.
- A live reading can run ahead of the leaderboard: the leaderboard refreshes on its own schedule. Differences of a problem or two are expected.
