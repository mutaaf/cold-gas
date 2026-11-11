---
id: 0190
title: On the Wall, the thumb that does what the pad says lands inside the painted rings, not 11 m past them
status: in-progress
priority: P1
size: M
lens: authenticity
created: 2026-11-10
pr:
by: critic
---

## Why
On the reveal, the touchdown was a place the flight computer chose and flew to (REVEAL_RESEARCH §2.1.4). On our Wall,
since 0182 made the mark count, the touchdown that Assist flies on its own lands outside its own target. A phone
player who does exactly what the pad says (hold to climb, tap on "Tap · Let go", hold "Hold · Land") scores
**76.3, "Clean", 12.8 m off the mark**. That's production, first visit, 390×844 touch
(`docs/critique/2026-11-10-2130/W-results.png`).

In Node (critique `docs/critique/2026-11-10-2130.md` §3, `thumb-mastery.test.js`'s `flyThumb`, no slide), every way
of pressing lands in the same place:

| one thumb, no slide | Wall | Show |
|---|---|---|
| held from the tap | 11.4 m, 77.3 | 6.0 m, 84.7 |
| tapped, never pressed again | 11.0 m, 78.0 | 6.2 m, 83.7 |
| pressed again 0.5 / 1.0 / 2.0 s | 11.4 / 11.1 / 11.0 m, 77.3–78.0 | 6.0 / 5.6 / 6.2 m, 83.7–86.7 |

- **The painted rings are 2 · 4 · 7 m** (`src/sim/courses.js:36`). The computer's touchdown is 4 m outside the
  outer ring, and its precision reads 1.8–2.1 / 10.
- **In `daily-reach`'s careful thumb population** (seed 12345, n 60), the p90 lands 11.4 m off: 16 of 60 score 77.3.
- **The Wall reference** (`createAutopilot`) lands on the mark at 97.7. The mark is reachable. The computer just
  doesn't fly to it.
- **The Show's computer lands 5.6–6.2 m off,** inside its outer ring.

The slide should be the skill that turns a ring into the centre. It shouldn't be the only way onto the paint at all.
0188 (ready) is about the pad's words. This ticket is about where the computer puts the car.

## What
Find where the Wall's Assist touchdown goes long first: the release push-off, the carry and the LAND governor's
along-run brake (`src/sim/vehicle.js` auto-land, `src/onethumb.js`'s Wall branch). Write the release-to-touchdown z
trace in the PR. Then either aim the computer's along-run touchdown at the pad, as the reference does, or move the
paint to where the reveal's car set down, if REVEAL_RESEARCH places it there. Cite the section either way.

## Acceptance criteria
- [ ] On the Wall, one thumb, no slide (held from the tap, tapped and never pressed again, pressed again at 0.5, 1.0
      and 2.0 s): every touchdown lands ≤ 7 m from the mark (today 11.0–11.4 m), Clean or better.
- [ ] The slide still pays: `thumb-mastery`'s 0182 test (best slide ≥ 5 points over no slide) still passes as
      written. If the no-slide flight lands nearer, the bar stays at 5 points.
- [ ] The release-to-touchdown time stays 4.1–4.95 s, touchdown g ≤ 1.6, and sink ≤ 1.3 m/s (the reveal's numbers,
      critique 2026-11-10-1600 §3).
- [ ] `daily-reach` thumb Wall: the p90 miss is ≤ 7 m; `stick-wall`, `soft-wall` and `pro-wall` stay over the floor.
- [ ] `naive-players` 32/32. If the sim changes, follow AGENTS.md §Invariants 4 (`SIM_VERSION`, vectors, Swift
      mirror).
- [ ] The Show and the Lineup: `ref-hash` totals unchanged.
- [ ] Funnel number to move: `run-landed` with a medal over bronze on the Wall among touch runs.

## Test plan
A unit test that flies the five thumb patterns above on the Wall and asserts the miss and the verdict. Extend the
0182 table in `tests/unit/thumb-mastery.test.js`.

## Out of scope
- The sight leading the slide (0180).
- The pad's words (0188).
- The Wall's medal bars, except as the PR's before/after.

## Critic note (2026-11-11)
The Wall's 11 m miss has two parts. On the no-slide thumb, `t.lateral` is +6.06 to +7.24 m and the along-run miss is
9.7 to 10 m (landZ −18.7 / −17.2 against pad z −9). The sideways part comes from the release roll's kick, which LAND never flies
back. That cause is the same on the Show, and it's filed as **0194**. Take 0194 first or with this ticket, and re-measure
the table above after. The along-run brake alone can't reach ≤ 7 m while 6–7 m of the miss is sideways. Production
today: the Wall, one thumb, first visit, **15.5 m off, 75.0** (`docs/critique/2026-11-11-0410/W-results.png`).
