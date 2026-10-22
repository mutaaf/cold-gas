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
