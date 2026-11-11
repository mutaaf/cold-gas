---
id: 0200
title: The Show's gas Daily and the Wall's stick Daily are met by almost every careful thumb since 0190
status: proposed
priority: P2
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
