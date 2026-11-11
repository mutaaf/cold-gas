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
two turns; slid down takes it back; taken only ≥ 6 m short of the line, where it can still brake to 6 m/s, so every call flies the
same 720). The pad reads `↑ for 720 · Drive` while the call can be made, then `Two turns · Drive`. Lineup Assist gold 90 → 92.5
(`src/medals.js`, under Pro's 93): no 360 reaches it, an unaimed 720 is 92, aimed 92.7–93. No sim or scorer change (ref-hash unchanged). Node, seed 12345, n 150 (half the
careful thumbs take the call, `flyThumbLineup`):

| | main | #315 |
|---|---|---|
| held from Go, no slide | 91.3 Gold | 91.3 **Silver** |
| p10 / p50 / p90 (p90 − p10) | 91.0 / 91.3 / 91.7 (0.7) | 91.0 / 92.0 / 92.7 (**1.7**) |
| Gold | 150/150 | 27/150 (18 %), all 720s |
| clean / wreck | 150 / 0 | 150 / 0 |
| roll-lineup / mark-lineup | 100 / 100 % | 100 / 100 % |

**Why the spread stays under 5:** the 720 pays +7.6 points in height and rotation, but it needs ≈ 13 m of apex (Assist rolls about
265°/s). The burn and LAND's brake from that height cost 3.1 of efficiency (−3.4 points), and unaimed it lands 4–6 m long. So the 720
scores 92.0–94.0 and the 360 90.3–91.7. Measured and ruled out: apex 7.5–9 m at 6–6.5 m/s (the second turn doesn't finish:
wrecked); 11 m (more gas, longer). Status stays `ready`. To pass, the scorer has to say what a 720's gas costs on the Lineup
(e.g. efficiency read per turn flown). That's a `SIM_VERSION` bump with vectors and the Swift judge, so it's the critic's or the
operator's call before a builder takes it. The iPhone's `Medals.swift` keeps 90 until 0186 ports the call (add a one-thumb Lineup
vector with a run-up slide then). Note: the population draws two more numbers per Lineup player, so its later players differ
from main's; the table compares the same seed, not the same players.


## Critic call (2026-11-11 21:36, after #315): no per-turn efficiency; the card names the way to Gold
Production `index-BfrEcyEr.js` (= main `fbad7ca`), 390×844 touch, CDP touches on the pad
(`docs/critique/2026-11-11-2136/`):

| thumb | pad words | apex | roll | miss | total | medal |
|---|---|---|---|---|---|---|
| held from Go, first visit (`L-held-results.png`) | Hold · Drive → **↑ for 720 · Drive** → Holding · Drive → Lifting → Rolling | 8.1 m | 360° | 1.3 m | 91.3 Stuck it | **Silver** · "Gold at 92.5 · 1.2 to go" |
| slid up 48 px at 0.4 s, no aim (`L-up720-results.png`) | Hold · Drive → **Two turns · Drive** → Lifting → Rolling | **14.6 m** | 720° | 4.2 m | 92.0 Perfect 10 | Silver · "0.5 to go" |

- **Criterion 1 passes on production.** The held thumb is Silver, not Gold.
- **Gold ≤ 50 % passes** (the builder's 27/150, all 720s).
- **The p90 − p10 ≥ 5 criterion: the builder's proposed fix is ruled out.** The 720 burns to 14.6 m (10.5 m over the
  semi's roof). That's nearly twice the reveal's kickflip: one 360° roll at a peak of about 7–8 m (paultan telemetry 7 m,
  NBC "27 ft"), with 2.5–3.5 s of airtime (REVEAL_RESEARCH §2.2, rows 46–47). No source shows the car rolling twice.
  - The gas the 720 burns to get that height is real, and the scorer is right to charge it.
  - Paying it back ("efficiency read per turn flown") would make the least reveal-like flight the most rewarded one.
  - Raising the roll rate isn't the way either. The stick's 4.6 rad/s (`src/sim/vehicle.js:340`) is anchored on the
    reveal's 180° in ≈1.1 s.
  - So the 720 stays what #315 made it: an optional trick that a careful thumb can fly onto the mark for Gold.
- **This criterion is replaced.** The medal ladder is the skill signal, and #315 meets it: held = Silver, an unaimed 720
  = Silver, the 720 on the mark = Gold. The p90 − p10 spread box is struck, by the critic who wrote it.
- **What still fails: a player can't find the way to Gold.**
  - The only cue is the pad's "↑ for 720" during the run-up's first seconds. A held thumb sees it for less than the
    sampling of one run.
  - The results card says "Gold at 92.5 · 1.2 to go". Then NEXT RUN says "try Pro and fly the landing yourself", and
    WHAT HAPPENED says "Want more? Try Pro" (`L-held-results.png`).
  - Pro is the two-thumb game. The one thing that earns Gold on one thumb is named nowhere on the card. Skill that the
    card never names doesn't show in the score.

### Amended acceptance criteria (critic, 2026-11-11 21:36)
- [x] One thumb on the Lineup, held from Go, no slide: Silver or below. Production 91.3 Silver.
- [x] Gold for ≤ 50 % of the careful `flyThumbLineup` population (#315: 18 %).
- [~] ~~p90 − p10 ≥ 5 points~~: struck by the critic. See above. Don't pay per-turn efficiency.
- [ ] On one thumb, a landed **360** on the Lineup has a results card whose NEXT RUN line names the call in the pad's
      words, e.g. "Next: slide up on the run-up for two turns, then aim for the mark". "Try Pro" can follow it but
      can't replace it. Assert this in `tests/e2e/lineup-thumb.spec.js` at 390×844.
- [ ] A landed, unaimed **720** has a card whose NEXT RUN names the aim ("hold in the air and slide onto the amber
      dot"). Production already does this (`L-up720-results.png`), so keep it.
- [ ] The title or the how-to card's Lineup rows say once that sliding up on the run-up calls two turns. One line,
      and the how-to stays one step on a first visit.
- [ ] The earlier boxes stand: clean ≥ 90 %, wrecks ≤ 5 %, `daily-reach` over the floor, `ref-hash` unchanged.
- [ ] Funnel number to move: `retry` / `run` on the Lineup among touch runs.
