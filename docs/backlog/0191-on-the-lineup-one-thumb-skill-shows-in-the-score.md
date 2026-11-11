---
id: 0191
title: On the Lineup, a thumb held from Go doesn't take Gold on its first run; skill shows in the score
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-10
pr: 315
by: critic
---

## Why
The focus's item 1 asks for "skill that shows in the score", and item 2 for medals as a reason to come back. 0181 gave
the Lineup the one-thumb pad, and it does land everyone (that part passes). But the pad flies the reference kickflip
for the player, and the Lineup's bars were set for two thumbs. `src/medals.js:26` still says "a clean 360 by hand is
the bronze". So:
- **Production, 390×844 touch, first visit, the thumb held on the pad from Go and never moved:** 91.3 "Stuck it",
  1.3 m off, **"New Gold · Gold held"** on run 1 (`docs/critique/2026-11-10-2130/L-results.png`). Gold is 90
  (`src/medals.js:32`).
- **`daily-reach`'s careful one-thumb Lineup population** (seed 12345, n 60, `flyThumbLineup`): totals **90.7–91.7**,
  60/60 Gold, 58 Stuck it, 2 Perfect 10. Misses are 0.7–2.0 m.
- **The Daily** `roll-lineup` and `mark-lineup`: 150/150 (100 %).
- **The judge's ceiling on one thumb is the reference's 91.7.** Height 7.6 and rotation 8.4 are the computer's, and
  the thumb can't change them (`judge.js` `scoreLineup`).

So the Lineup's whole range, from a first-timer to the best thumb, is 1 point, and there's nothing left to win after
run 1. On the Show the same population spans 84.7–94.7 and on the Wall 77.3–96.7.

## What
Give the one thumb a choice the judges can see on the Lineup, then set the bars on the measured population. Either:
- the slide (or a held vs. tapped LAND) moves something the scorer weighs (precision band 16 → 0.8 m is nearly
  saturated at 1.3 m); or
- the thumb picks the trick (the kickflip vs. a second roll, as `scoreLineup` already pays 720 more); or
- the Lineup's one-thumb medals are re-set so the held-from-Go thumb is Bronze or Silver and Gold needs the choice.

Whichever, write the split decision out (LESSONS 2026-11-09) with the before and after, and don't loosen a Daily.

## Acceptance criteria
- [ ] One thumb on the Lineup, held from Go, no slide: Silver or below (today Gold, 91.3).
- [ ] `flyThumbLineup` careful population (n 150, seed 12345): the p90 − p10 total ≥ 5 points (today 0.7), and Gold
      for ≤ 50 %.
- [ ] Every one-thumb Lineup flight still lands clean ≥ 90 % and wrecks ≤ 5 % (0181's bar).
- [ ] `daily-reach`: `roll-lineup` and `mark-lineup` over the floor.
- [ ] `ref-hash` unchanged unless the scorer changes (then `SIM_VERSION`, vectors, Swift per AGENTS.md §Invariants).
- [ ] Funnel number to move: `retry` / `run` on the Lineup among touch runs.

## Test plan
A unit test over the seeded `flyThumbLineup` population asserting the spread and the Gold share. A held-from-Go flight
asserting its medal.

## Out of scope
- The two-thumb Lineup (classic).
- The row's order and colours (0029).
- The iPhone port (0186).

## Builder pass 1 (2026-11-11, #315): the thumb picks the trick; the spread needs a scorer call
Shipped: on the run-up a held thumb slid up calls a second turn (`src/onethumb.js` `LINEUP_TWICE`: run-up 6 m/s, burn to 10.25 m,
two turns; slid down takes it back; commits at the line). The pad reads `↑ for 720 · Drive`, then `Two turns · Drive`. Lineup Assist
gold 90 → 93 (`src/medals.js`): no 360 reaches it. No sim or scorer change (ref-hash unchanged). Node, seed 12345, n 150 (half the
careful thumbs take the call, `flyThumbLineup`):

| | main | #315 |
|---|---|---|
| held from Go, no slide | 91.3 Gold | 91.3 **Silver** |
| p10 / p50 / p90 (p90 − p10) | 91.0 / 91.3 / 91.7 (0.7) | 91.0 / 91.7 / 92.7 (**1.7**) |
| Gold | 150/150 | 15/150, all aimed 720s |
| clean / wreck | 150 / 0 | 150 / 0 |
| roll-lineup / mark-lineup | 100 / 100 % | 100 / 100 % |

**Why the spread stays under 5:** the 720 pays +7.6 points in height and rotation, but it needs ≈ 13 m of apex (Assist rolls about
265°/s). The burn and LAND's brake from that height cost 3.1 of efficiency (−3.4 points), and unaimed it lands 4–6 m long. So the 720
scores 91.3–94.3 and the 360 90.3–91.7. Measured and ruled out: apex 7.5–9 m at 6–6.5 m/s (the second turn doesn't finish:
wrecked); 11 m (more gas, longer). Status stays `ready`. To pass, the scorer has to say what a 720's gas costs on the Lineup
(e.g. efficiency read per turn flown). That's a `SIM_VERSION` bump with vectors and the Swift judge, so it's the critic's or the
operator's call before a builder takes it. The iPhone's `Medals.swift` keeps 90 until 0186 ports the call.

