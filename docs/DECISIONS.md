# Decisions and assumptions to confirm

1. **Zero clamp on the rating term: confirmed.** `max(0, rating − baseline)²/10`. The Smart Interviews leaderboard exported on 2 October 2026 reproduces to the point under this rule for every platform in the author's row (CodeChef: 128 problems, rating 1,153 against a baseline of 1,200, 18 contests = 1,156; unclamped it would be 1,377). The clamp remains one constant in `domain/score.ts`, and a regression test (`LEADERBOARD_2026_10_02`) holds the full row: 13,200.
2. **Rounding.** Each platform total is floored (matches 2,102 and 392).
3. **Smart Interviews, InterviewBit, HackerRank** are recorded contributions (manual or imported). No formula is invented. They are 71% of the current score; the UI says so.
4. **Automatic verification is real only for Codeforces** (official API). LeetCode and CodeChef have no approved automatic route for personal submissions, so they use import plus a labelled MANUAL fallback. A day of only manual items is COMPLETE · MANUAL, never VERIFIED.
5. **Quota objectives.** Daily items are per-platform quotas ("2 new accepted LeetCode problems") satisfied by any new accepted problem that local day; suggested problems are guidance. This avoids failing a day because a different good problem was solved.
6. **Baseline mechanics.** Counts are derived as a base value (seed/import) plus events after `base_as_of`. Older acceptances are remembered (never re-suggested) but never double counted. For Codeforces, "Use synced history as the source of truth" sets the base to zero after a verified sync.
7. **Target date is user-set and optional.** Without it, pace is INSUFFICIENT DATA. Projection is labelled a projection.
8. **Home order.** NEXT comes before TODAY on the home page so the single next action is visible right after the score (the spec listed both orders).
9. **Problem pool** is a committed list of real LeetCode/Codeforces problems with real URLs plus a few CodeChef codes. When a platform has no unsolved suggestion, the objective links to that platform's real practice page instead of inventing problems. Replace or extend `server/src/data/problems.json`.
10. **Contest discovery.** Codeforces via the official API; LeetCode/CodeChef/HackerRank via clist.by when `CLIST_USERNAME`/`CLIST_API_KEY` are set, or a `contests.json` file. Codeforces `type: CF` is treated as rated.
11. **Notifications** use Web Push with VAPID (no FCM needed). If push is not configured or there is no subscription, reminders are recorded as SKIPPED with the reason. They are never reported as delivered.
12. **Design tokens.** The reference scale is display-oriented, so UI text uses 16/19px and the 35–219px sizes are reserved for display. `#E33529` is used only for large type, marks and fills (3.0:1 on the pink surface). Neue Montreal is a commercial font: add a licensed file, otherwise a Helvetica stack is used. Bayon is bundled via `@fontsource/bayon`.

11. **Reconciling with the leaderboard.** The 12,604 in the development seed is an earlier snapshot, not an error in the formula. By 2 October the leaderboard
    row was 13,200: Smart Interviews 8,076 (Basic 2,046 + Primary 6,030, against 7,976 held), LeetCode 2,542, CodeChef 1,156, Codeforces 392, HackerRank 126
    (Data Structures 30 + Algorithms 96) and InterviewBit 908 (score 4,540 ÷ 5). A mismatch therefore arises from stale entered figures, or from a platform and
    the leaderboard being read at different times, never from the arithmetic. Preferences now take the leaderboard's own columns for the three manual
    platforms and add them as the leaderboard does, and Trajectory carries a leaderboard check that sets each platform's figure against the row.
12. **Calendar link.** Reminders reach a person's own calendar through a private `.ics` link (`/api/feed/<token>.ics`) and a per-contest download. The link is
    authenticated by a random 256-bit token stored only as a SHA-256 hash, is replaceable and revocable, is read-only, is rate-limited, and is never logged in
    full. It lists the same contests as the push schedule (committed ones, and rated ones on the person's platforms), with alerts at 24 hours, 1 hour and 10
    minutes. Calendar applications refresh subscribed links at their own pace, so push remains the channel for the final hour.
13. **After the target is reached.** The briefing offers, and never imposes, a successor target. Three options are computed from the person's own figures
    (a near goal, a stretch goal, and a skill goal tied to the nearest rating milestone), and keeping the present target is offered explicitly. Rationale:
    - Locke and Latham, [Building a practically useful theory of goal setting and task motivation](https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf) (2002): specific, difficult goals sustain performance, and a goal that is met without a successor stops directing effort.
    - Kivetz, Urminsky and Zheng, [The goal-gradient hypothesis resurrected](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2733214) (2006): effort rises near a goal and resets once it is met.
    - Ryan and Deci, [Self-determination theory and the facilitation of intrinsic motivation](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf) (2000): autonomy and competence sustain motivation, so the person chooses, and one option is a skill goal.
    - Gollwitzer, [Implementation intentions: strong effects of simple plans](https://www.prospectivepsych.org/sites/default/files/pictures/Gollwitzer_Implementation-intentions-1999.pdf) (1999), and Gollwitzer and Sheeran (2006): a plan of the form "when X, I will Y" improves follow-through.
    The satisfaction of arrival is also known to fade quickly (hedonic adaptation), which is why the prompt appears at once rather than after a lapse.
14. **Links never lead to the page already open.** The briefing's "go to today's list" scrolls to the list; "Prepare with practice" opens Practice; the completed-day
    action opens the Record directly rather than through the retired `/calendar` address.
