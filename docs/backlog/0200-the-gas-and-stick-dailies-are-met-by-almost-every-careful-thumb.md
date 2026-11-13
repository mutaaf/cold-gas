---
id: 0200
title: The Show's gas Daily and the Wall's stick Daily are met by almost every careful thumb since 0190
status: proposed
priority: P1
size: S
lens: engagement
created: 2026-11-11
pr:
by: builder
---

## Why
0190 (SIM_VERSION 32) keeps LAND's line hold on down to 1.5 m and aims the Wall's computer along the run. The first run
lands on the paint, as the owner asked, but two Daily objectives stopped being a stretch for `daily-reach`'s careful thumb
population (`node scripts/daily-reach.mjs 60`, seed 12345):
- `gas-show` ("Clear the row with more than 25 % gas left"): 31/60 (52 %) → 58/60 (97 %).
- `stick-wall` ("Stick it: score 84+"): 44/60 (73 %) → 60/60 (100 %).

`tests/unit/daily-reach.test.js` (0135/0176: "the Show's Dailies stay a stretch") had to leave `gas-show` out of its
"some still short" check in the 0190 PR. A Daily nobody can miss isn't a reason to come back (the same finding as 0198 for the
Lineup).

## What
Re-set the two objectives' bars in `src/daily.js` on today's populations (e.g. more gas left; a higher score or a mark on
the Wall), so each sits in the 30–70 % band again, and put `gas-show` back in the test's "some still short" list.

## Acceptance criteria
- [ ] `daily-reach` n 150: `gas-show` and `stick-wall` each met by 30–70 % of the thumb population.
- [ ] `tests/unit/daily-reach.test.js` lists `gas-show` among the objectives that still leave some short.

## Test plan
Extend `tests/unit/daily-reach.test.js`: `gas-show` back in the "some still short" list, and both objectives under 1 and over the floor on its n 40 sample.

## Critic (2026-11-12 10:00): sharpened, and set to ready P1
This is no longer two objectives. It's four of the ten, and today's is one of them. On `8120984`,
`node scripts/daily-reach.mjs 150` (seed 12345, the thumb population):

| objective | met | today |
|---|---|---|
| `scratch-show` "Clear the row without a scratch" | **150/150, 100 %** | the 2026-11-12 Daily |
| `stick-wall` "Stick it: score 84+" | **150/150, 100 %** | 11-14, 11-18 |
| `gas-show` "more than 25 % gas left" | **145/150, 97 %** | 11-15, 11-20 |
| `soft-wall` "2.6 ft/s or softer" | **134/150, 89 %** | 11-21 |

On production, 390×844 touch, first visit, a thumb that only did what the pad said: the first run (87.3, 5.5 m off)
read **"Daily ✓ complete · streak 1"** (`docs/critique/2026-11-12-1000/show-r1-results.png`). The second run did too,
at 80.7. That's 0198's finding again: the streak counts a run nobody chose anything in, on 6 of the next 10 days
(11-12 to 11-21).

Added criteria (the original two still stand):
- [ ] `daily-reach` n 150: `scratch-show` and `soft-wall` are each met by 30–70 % of the thumb population too.
- [ ] A one-thumb Show flight held from Go and never slid (`tests/unit/daily.test.js`, as 0198's held Lineup flight)
      meets neither `scratch-show` nor `gas-show`. A Wall flight that follows the pad meets neither
      `stick-wall` nor `soft-wall`. Each miss line names the choice in the pad's words (0139/0150).
- [ ] `tests/unit/daily-reach.test.js` gets a ceiling (≤ 70 %) for every objective as well as its floor, so a sim
      change that empties a Daily goes red in the PR that makes it.
