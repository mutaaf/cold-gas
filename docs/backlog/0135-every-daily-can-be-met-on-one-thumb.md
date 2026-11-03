---
id: 0135
title: Every Daily objective can be met by a one-thumb phone player, and a gate keeps it so
status: ready
priority: P1
size: M
lens: engagement
created: 2026-11-03
pr:
by: scout
---

## Why
The Daily is the title's only reason to come back, and most players are on phones, which fly the Show on one thumb
(Assist). Production's funnel agrees: `/obs/digest` players for 2026-11-02 show `daily-run` 6 and `daily-done` 0
(`daily-run` fires on a *missed* Daily, `src/comeback.js:203`).

Measured today on the one-thumb population (`node scripts/human-phone.mjs 150 --scheme=thumb --skill=<none|careful> --dump=f.json`,
each card checked with `evaluate(objective, scoreRun(t), 'show')`):

| objective (`src/daily.js`) | skill none | skill careful |
|---|---|---|
| mark-show (within 3 m) | 0 / 150 | 16 / 150 |
| gas-show (> 40 % gas) | 0 / 150 | 0 / 150 (ticket 0134) |
| ninety-show (score 90+) | 0 / 150 | 109 / 150 |
| skim-show, scratch-show | 100 and 150 / 150 | 124 and 150 / 150 |

The median touchdown on one thumb is 1.3 to 1.5 m/s, so `soft-wall` (0.8 m/s) is likely out of reach too; the Wall,
Lineup and Pro objectives are not measured by any script. So on 4 of the 10 Show-side days a phone player is shown a
goal they cannot meet, then told "try again". Nothing in the repo checks that a Daily is meetable.

## What
- Extend `scripts/human-phone.mjs` (or a sibling `scripts/daily-reach.mjs`) to print, for every objective in `OBJECTIVES`,
  the share of the one-thumb `careful` population that meets it (Wall and Lineup via the autopilot-with-thumb-input used
  elsewhere; Pro and Advanced objectives are measured on the keyboard/two-thumb population instead, stated in the output).
- Set each objective's bar (`src/daily.js`) so at least 30 % of its measured population meets it and a clearly better
  flight is still worth more (the goal text and `miss` line follow the number). Do not touch the sim or the scorer.
- Add `tests/unit/daily-reach.test.js` that runs a small seeded population (n = 40, fixed seed) through the same
  harness and fails if any objective drops below the floor. `gas-show` is handled by 0134: until it ships, list it as a
  known miss in the test with a pointer, not a skip of the others.

## Acceptance criteria
- [ ] The reach table is printed for all ten objectives with n and the population named
- [ ] Every objective has ≥ 30 % reach in its population (gas-show excepted until 0134 ships, then included)
- [ ] The title card and the results' Daily line read the new numbers in both unit systems
- [ ] `reference-hash`, naive-players 32/32 and the daily unit tests unchanged or updated with reasons; no dark patterns
- [ ] 390×844 touch: the Daily card still fits on one line of goal text

## Test plan
`tests/unit/daily-reach.test.js` (seeded, n = 40) plus the existing `tests/unit/daily.test.js`; a screenshot of the title's
Daily card on a changed objective.

## Out of scope
The gas fix itself (0134), new objectives, streak rules, the sim.
