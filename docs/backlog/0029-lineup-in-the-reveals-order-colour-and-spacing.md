---
id: 0029
title: Park the row in the reveal's order, colours and 15–17 m span
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
The operator's focus item 4 is "the wall and lineup geometry and the parked vehicles matched to
reveal footage". The research frame-read the row (docs/REVEAL_RESEARCH.md §2.2, REPORTED + PHOTO):
in the order the roadster crossed it, **gold cab → stainless pickup → semi (centre) → crossover →
sedan (dark)**, parked crosswise on a low red-lit plinth, **span ≈ 15–17 m** (ESTIMATE, five widths
plus gaps), lift-off just short of the first vehicle and touchdown just past the last.

The game (main 5a5ecf2, `src/sim/courses.js:111-148`, docs/VEHICLES.md "The reveal's row"):
- Order crossed: **sedan → crossover → semi → pickup → cab**, exactly reversed. VEHICLES.md says so
  and keeps it "so the Show's geometry stays put"; the Show has since been re-tuned twice (0014,
  0019), so that reason no longer holds.
- Colour: the **crossover** is the dark one (`paint 0x1d1f24`) and the sedan is light (`0xe8e8ea`);
  the reveal's dark car is the sedan.
- Span: gaps are 0.62 m, row **12.63 m** (z 7.0 → 19.6), 16–26 % short of the low end of the estimate.

Anyone comparing the kickflip side-shot with ours sees the gold cab come first in the reveal and last
in the game.

## What
- `src/sim/courses.js`: `LINEUP_SPEC` in crossing order cab, pickup, semi, crossover, sedan for the
  Lineup; the Show's row is built mirrored from the lip, so check it also reads cab first as the car
  crosses it. Sedan paint dark, crossover light (or the frame-read colours if VEHICLES.md finds them;
  tag PHOTO).
- Gap chosen so the span is 15–17 m (state the number and its reasoning as ESTIMATE in VEHICLES.md).
- Keep the pad on the far side of the last vehicle; move the Lineup/Show pads only if the bars below
  need it, and say so.
- Bump `SIM_VERSION` (collision geometry); regenerate replay fixtures; update docs/VEHICLES.md.

## Acceptance criteria
- [ ] Unit test: in both courses the first box the car's path crosses is the cab and the last the
      sedan; the semi is third; row span 15.0–17.0 m.
- [ ] Lineup reference (`scripts/setdown-probe.mjs`): lift-off → wheels ≤ 3.8 s, airborne distance
      20–30 m (§2.2), touchdown within 4 m of the mark, sink ≤ 1.5 m/s (0014's bars).
- [ ] Show reference: clears every roof (`contact: false`), release → wheels < 6 s, still 94 ± 3.
- [ ] `naive-players` 32/32, `naive-show` ≥ 51/54 over the row, cue followers ≥ 95/100.
- [ ] Screenshot at 1280×720 and 390×844 of the row from the run-up: gold cab nearest, dark sedan
      farthest.
- [ ] Node, Chromium and WebKit replays IDENTICAL.

## Test plan
A `tests/unit/objects.test.js` (or courses) case for order, colour ids and span; existing setdown,
gtrace and reference tests guard the flights.

## Out of scope
The red-lit plinth (cosmetic under the current focus), vehicle model detail, the Wall's lip height.
