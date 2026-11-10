---
id: 0182
title: On the Wall, the mark counts. A touchdown outside the 4 m ring isn't a Perfect 10, and the slide that finds the mark shows in the score
status: shipped
priority: P1
size: S
lens: authenticity
created: 2026-11-10
pr: 295
by: critic
---

## Why
The focus's item 1 includes "skill that shows in the score". On one thumb the slide is the skill, and since 0177 the
Wall's tapped thumb has the slide's full reach. But on the Wall the judges barely look at where the car lands:
- **The Wall still uses the old linear precision curve:** `c.precision = 10 * band(padMiss, 20, 1)`
  (`src/sim/judge.js:155`). The Show dropped that line for `SHOW_PRECISION` (`judge.js:98-101`) because it "kept 74 %
  of the marks for a 6 m miss outside the 4 m ring".
- **The Wall's precision weights are 0.16 · 0.06 · 0.14** (`judge.js:76-78`). The Show's are 0.36 · 0.28 · 0.34.

Critique `docs/critique/2026-11-10-0950.md` §2 measured it on main `a379559`, in Node with `thumb-mastery.test.js`'s
`flyThumb` on the Wall:

| tapped thumb, pressed again | no slide | best slide | points the slide earns |
|---|---|---|---|
| 0.5 / 0.6 s | 6.1 m off, 90.7 | −32 px: 1.3 m, 92.0 | **+1.3** |
| 1.25 / 1.75 s | 7.2 m off, 90.7 | −32 px: 0.1 m, 92.7 | **+2.0** |
| 2.25 s | 7.2 m off, 90.7 | −40 px: 0.7 m, 92.7 | **+2.0** |

- Putting the car on the mark from the painted outer ring is worth 1.3–2 points out of 100.
- The careful dot-follower, pressed again at 2.5 s, lands **8.2 m off, outside the 7 m outer ring, and reads "Perfect
  10" (93.0)**.
- In `daily-reach`'s Wall thumb population (`flyThumb('wall')`, seed 12345, n 60), 19 of 60 land outside the 4 m ring.
  3 of those are called Perfect 10, and the p90 lands 11.4 m off at 90.7.

This also sets the value of 0180, the Wall's sight leading a careful thumb onto the mark. On today's scale that work
earns about 2 points. The real car's touchdown was a place it chose and flew to (REVEAL_RESEARCH §2.1.4). Landing
outside the painted rings isn't a perfect run.

## What
`src/sim/judge.js` (`scoreWall`, the Wall's branch only): read the Wall's mark off its painted rings (2 · 4 · 7 m,
`src/sim/courses.js:36`) as the Show does, and/or raise the precision weights so that finding the mark shows. Two more
things:
- **Verdict:** a touchdown outside the 4 m ring can't be "Perfect 10", whatever the total.
- **Rules:** this is a scorer change, so it follows AGENTS.md §Invariants 4: bump `SIM_VERSION` and regenerate the
  vectors. The board and the Worker score with the same `scoreRun`. Say in the PR what that does to the existing Wall
  board.

## Acceptance criteria
- [x] Unit (`tests/unit/judge*.test.js`): on the Wall, a landing 4.1 m or more from the mark is never verdict
      "Perfect 10".
- [x] Unit (the `thumb-mastery` Wall flight, tapped, pressed again at 1.25 and 2.25 s): the best slide in −48 … 0 px
      scores ≥ 5 points more than no slide (today +2.0).
- [x] The Wall reference (`ref-hash`, 96 today) loses ≤ 0.5 points. Write its new total in
      the PR.
- [x] `node scripts/daily-reach.mjs`: `stick-wall` (84+), `soft-wall` and `pro-wall` stay over the floor. If a bar
      needs re-setting, write it up with the before and after (LESSONS 2026-11-09: split the decision out, don't bend
      the gate).
- [x] `naive-players` 32/32 still land upright (the scores may move; write the range before and after).
- [x] The Show and the Lineup score exactly as before (`ref-hash` totals 97.3 and 91.7).

## Test plan
Add a Wall precision table to the judge's unit test (miss 0, 2, 4, 5, 7, 12 m → precision and verdict). Extend
`thumb-mastery.test.js`'s 0177 sweep with the score delta for the best slide.

## Out of scope
- The Show's curve and weights.
- The Lineup's judging.
- The sight and the slide themselves (0177, 0180).
