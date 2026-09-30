# VECTOR design and motivation notes

## Structure
Five screens, because every extra screen is a decision the user must make before doing the work (Hick's law).

| Screen | Job |
|---|---|
| Today | Your score, the one thing to do next, today's list, your week. The whole loop on one page. |
| Path | Where you stand, pace, what moves the score, the simulator. Replaces Trajectory, Score, Analytics. |
| Contests | Next contest, commit, prepare. |
| Log | Calendar, earned awards, contest history. Replaces Calendar and Awards. |
| Settings | Goal, sources, reminders. |

Old links keep working (redirects): /today, /calendar, /awards, /trajectory, /score, /analytics, /problems. A secondary /practice page lists the problem pool.

## Visual system (tokens from the dontboardme.com extraction)
- Six colors only: surface #F4CED3, deep #F0B5BE, ink #000000, light #F3F3E9, link #0000EE, accent #E33529.
- Red accent appears once per view, on large type only (3:1 on pink), so it is always the thing that matters: a countdown, the 25K+ mark.
- Bayon: numerals and page titles only. Times: statements and the motivating line. Neue Montreal for UI, with Inter as the shipped stand-in (Neue Montreal is a commercial font: put licensed files in web/public/fonts and add @font-face to use it).
- Scale: 219 / 82 / 49 / 35 / 19 / 16 px at desktop; recomposed fluidly on mobile. Sentence case; no tracked-uppercase labels.
- Sharp corners, no shadows, hairline rules, color-blocked bands. Motion: rise on load, bar fill, count-up; all off under prefers-reduced-motion.

## Behavioural principles and where they appear
| Principle | Implementation |
|---|---|
| Goal-gradient effect | The hero shows the distance to the next milestone ("1,346 to the 14K mark") before the far target, plus a true 0 to 25K bar. |
| Fogg behaviour model (make it tiny, give a prompt) | One primary action, "Start now", opens the first unsolved problem. The copy makes the first step small: "One problem is the whole job right now." |
| Implementation intentions | The next action names the exact problem and platform, not "practise". |
| Zeigarnik effect / endowed progress | Pips per quota ("1 of 2"), and "You have started, which was the hard part. 1 to go." |
| Peak-end / celebration | Completion flips the next block to "Done. +24 today." with a verified/unverified distinction. |
| Identity-based motivation | Streak copy: "14 verified days in a row. This is what showing up looks like." |
| Commitment and consistency | Contest commitment ("I am doing this one") with reminders at 24 h, 1 h and 10 min. |
| Von Restorff | Only one red element per screen. |
| Loss aversion, used lightly and truthfully | Evening copy with an active streak: "One problem keeps the 6-day chain." Never invented urgency, never shame. A missed day is recorded, not punished. |
| Honesty over hype | Self-marked work says "Marked done" and is never shown as verified. Stale sources say so. "Insufficient data" is shown as "Building your baseline, 3 of 7 days". |

## Copy rules
1. Every line is true of the data that triggers it.
2. Specific beats general. Small beats big.
3. No guilt, no streak-shaming, no fake scarcity.
4. Lines rotate deterministically per day (copy.ts), so the page does not change on re-render.
