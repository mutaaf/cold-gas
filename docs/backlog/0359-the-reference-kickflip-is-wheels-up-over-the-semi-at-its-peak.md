---
id: 0359
title: The Lineup reference is wheels-up over the Semi at its peak, as the reveal's kickflip was
status: proposed
priority: P1
size: S
lens: authenticity
created: 2026-11-22
pr:
by: critic
---

## Why

SCOUT 2026-11-26: held at proposed to keep the ready queue at its cap of 10; the funnel (21 landings, 0 posts, 0 shares) puts 0364/0365/0366 first. Promote when room.
The one picture everyone kept from the reveal's second stunt is the car **upside down over the Semi at the top of its
arc**. REVEAL_RESEARCH §2.2 (frames at 4 fps from Tesla's side camera, https://www.youtube.com/watch?v=r5vsHHPVhJg) puts
it this way:
- "peak and inverted at about t0 + 1.2–1.5 s, over the Semi"
- "upright again at about t0 + 2.2 s"
- "Frames show the car wheels-up over the Semi"

The game's Lineup reference ("the reveal", the ghost, the first visit's taste) gets the arc right:
- 7.5 m/s off flat ground (research 7–9)
- apex 8.06 m (research 7–8.2)
- the apex at lift-off +1.4 s (research 1.2–1.5)

But **its roll is over before the peak.** From `docs/critique/2026-11-22-2230/lineup-roll.txt` (Node, main `4a91242`;
production stepped at 60 fps gives the same, `lineup-prod.mjs.txt`):
- **Fully inverted at +1.01 s, at z 9.1.** That is over the gap before the Crossover, 0.4 s before the apex.
- **Over the Semi** (z 12.01–14.60, `LINEUP_BOXES[2]`) it is only **77° → 24°** from upright. At the apex (+1.4 s) it's
  at 72–77°.
- Past 150° only from +0.90 to +1.12 s. Within 10° of upright again at +2.02 s: the end of the roll is on time, and its
  middle comes early.

The cause: the pilot rolls at full rate the instant the lift burn ends (+0.35 s), with
`if (!st.rollDone && st.burnDone) … out.roll = -1` (`src/sim/autopilot.js:168-173`). The car turns 360° in ≈ 1.3 s, and
the roll is centred on +1.0 s instead of on the peak. On the phone the inverted frame shows the car over the dark gap,
with the Semi below and behind it (`lineup-phone-lift+1.00-dt1-tilt178.png`). Over the Semi it is a car on its side
(`…-over-semi-dt1.55-tilt34.png`).

## What
`src/sim/autopilot.js` `lineupPilot` only. Time the roll so its 180° falls at the apex over the Semi. For example:
- start it at a time computed from the projected apex and the roll's rate and brake (`plan.rollBrake`);
- or roll at a lower commanded rate across lift-off +0.4…+2.2 s;
- or both.

Still one 360° roll, Assist, the same lift and carry. No change to the flight computer, the sim or the scorer (no
`SIM_VERSION` bump). The reference's log changes, so regenerate the vectors in the same PR (`npm run vectors`;
`scripts/vectors-lib.mjs:205` flies `createAutopilot('lineup')`). `ref-hash`'s lineup line changes, and show and wall
stay bit-identical.

## Acceptance criteria
- [ ] In the Lineup reference, the **most inverted moment** (min of body-up · world-up) is within **±0.15 s of the apex**,
      and the car's z there is inside the Semi's box (12.01–14.60). Today it is 0.39 s early, at z 9.1.
- [ ] The car is **≥ 150° from upright while its CoM is over z 12.3–14.3**. Today it is 77° → 24°.
- [ ] It is still within 10° of upright first at lift-off **+2.0–2.4 s** (research ≈ 2.2; today 2.02, a guard), and level
      before the down-jets' brake starts.
- [ ] One roll: |`rollAccum`| = 2π ± 0.1. The verdict stays "Stuck it", score ≥ 91, `minClearance` ≥ 1.0 m, and sink at
      touchdown ≤ 1.0 m/s (today 91.7 · 1.29 m · 0.81 m/s).
- [ ] `naive-players` 32/32, `naive-show` 54/54 and `npm test` stay green. `ref-hash` show and wall are unchanged.
      Vectors are regenerated, and `check` is green.
- [ ] A 390×844 frame from production (or the preview) at the apex shows the car wheels-up over the Semi.

## Test plan
A unit test steps `createAutopilot('lineup')` and asserts the first three bars: the inverted moment against the apex
and the Semi's box, the tilt over z 12.3–14.3, and the upright time. It reads the box from `LINEUP_BOXES`, never a copy.
Make the test fail on main first.

## Out of scope
- The camera (0358).
- The Lineup's pad placement and air time (+3.6 s and 27 m against the research's ≈ 3 s and 20–25 m, ESTIMATE). That is
  noted in the 2026-11-22 22:30 critique, not filed.
- The player's own roll: Assist's rate and how a player times it are theirs.
