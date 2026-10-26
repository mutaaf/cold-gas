---
id: 0065
title: The timeline says BRAKE only while the car is braking, not through the free fall
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr:
by: critic
---

## Why
The HUD's job is to be honest about the moment, and the timeline lights 06 BRAKE through a second of
free fall. Show reference on production (81899cb), 2026-10-22, sampled every 0.05 s after the release
(specific force from Δv; `hud.dataset.phase`):

| t after release | timeline | alt | sink | specific force |
|---|---|---|---|---|
| 0.60 s | CARRY | 25.2 m | 6.8 m/s | 0.54 g |
| **0.80 s** | **BRAKE** | 23.7 m | 8.0 m/s | 0.67 g |
| 1.25 s | BRAKE | 19.7 m | 10.6 m/s | **0.03 g** |
| 1.50 s | BRAKE | 16.8 m | 13.0 m/s | **0.03 g** |
| 1.75 s | BRAKE | 13.2 m | 15.3 m/s | 0.35 g |
| 2.00 s | BRAKE | 9.5 m | 13.7 m/s | 2.6 g |

CARRY lasts 0.2 s. BRAKE lights at 23.7 m because the roll-out's attitude pulses push the four lift
nozzles' sum past 1.2 (`src/main.js:495`), and the timeline never steps back (`S.phaseMax`, `:498`), so
it reads BRAKE while the car falls at 0.03 g. On screen: "06 BRAKE" over G 0.5 at 19.8 m
(`docs/critique/2026-10-22-0400/desk-4-release.jpg`, `phone-4-release.jpg`). In run 2's telemetry
(docs/REVEAL_RESEARCH.md §2.1.4, TELEMETRY) the car read 0.2–0.4 G for 1.5 s after the release (67.5 →
62.2 ft) and braking began at 39 ft (12 m) with 1.7 G; a viewer comparing the two sees the game
"braking" twice as high as the car did, at a moment it isn't braking at all.

## What
- `src/main.js` `flightPhase`: BRAKE on a sustained deceleration, not a nozzle sum: e.g. the G window the
  HUD already shows (0018's Δv mean, LESSONS "Average a G window as Δv") ≥ 1.2 g with sink > 0.5 m/s for
  ≥ 0.15 s, or the flight computer's own brake state (`pr.brakeBy` crossed) for Assist. Keep the
  monotonic timeline (no flapping, 0047). The Lineup's BRAKE rule (`:489`) gets the same check.
- No sim change.

## Acceptance criteria
- [ ] e2e on the Show reference: while the timeline reads BRAKE in the air, the 0.5 s G window reads
      ≥ 1.0 g in ≥ 95 % of 0.05 s samples, and no BRAKE sample has a 0.25 s specific force < 0.3 g.
- [ ] CARRY is shown for ≥ 1.0 s of the reference's fall (it is the carry over the row).
- [ ] The timeline still reaches BRAKE before TOUCHDOWN on the Show, the Wall and the Lineup references,
      and a player's no-brake crash (all valves shut after the release) never shows BRAKE.
- [ ] `tests/e2e/timeline.spec.js` (0022) stays green.
- [ ] Screenshots at 390×844 and 1280×720 of the carry and the brake in the PR.

## Test plan
Extend `tests/e2e/timeline.spec.js`: sample `dataset.phase` with the G window per `liveStep(0.05)`.

## Out of scope
Where the brake itself happens (0028, the brake height in the sim), the descent tape (0055).

## Critic re-measure (2026-10-22 22:00, production da53d64)
Still failing, to the frame:
- **Reference**: `05 CARRY` at release + 0.65 s, `06 BRAKE` from + 0.85 s (23.3 m). Of 33 BRAKE air
  frames, 22 have ≥ 1.0 g (67 %, the bar is 95 %) and 8 have < 0.3 g (+ 1.05 to + 1.75 s, 21.7 → 13.2 m,
  0.02–0.22 g). CARRY shows for 0.2 s against the ≥ 1.0 s bar. The HUD reads "06 BRAKE · G 0.2 g"
  (`phone-4-release.jpg`).
- **A no-brake crash shows BRAKE** (fails criterion 3). Every input was zeroed from release + 0.125 s,
  so the valves are shut and the fall is free (0.00 g). The timeline still went `05 CARRY` at + 0.65 s,
  then `06 BRAKE` at + 0.75 s (23.3 m) and held it to impact. It then marked `07 TOUCHDOWN` over the
  car on its roof (`phone-C-7-touchdown.jpg`, `desk-C-7-touchdown.jpg`). 0072 owns the wreck's label.
  The BRAKE half is this ticket's.

## Critic re-measure (2026-10-26 21:36, production 77cc6d5)
Unchanged. Unique air ticks of the Show reference:

| Viewport | BRAKE from | BRAKE frames | < 1 g | < 0.3 g |
|---|---|---|---|---|
| 1440×900 | +0.72 s, 23.7 m | 35 | 13 | 8 |
| 390×844 | +0.82 s, 23.2 m | 37 | 12 | 10 |
| 844×390 | +0.83 s, 23.3 m | 37 | 14 | 9 |

The force is the sim's own per-tick `run.gWin`.

The valves-shut crash at 390×844 (all inputs zeroed from release + 0.125 s) shows `05 CARRY` at +0.62 s,
then `06 BRAKE` from +0.72 s to impact. That's 41 frames, 32 of them < 1 g and 19 < 0.3 g. After the impact
(+2.95 s) the timeline reads `07 TOUCHDOWN` for 0.46 s over a car on its roof, with `WRECKED 66 %` in red
beside it (`docs/critique/2026-10-26-2136/phone-C-7-touchdown.jpg`). It becomes `07 FLIPPED` only when the
run ends (+3.41 s).

Added criterion: a step labelled TOUCHDOWN is never `now` while `[data-dmg]` reads `wrecked`, so the crash
label is shown from the impact, not from the run's end.
