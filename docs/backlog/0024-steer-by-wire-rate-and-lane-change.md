---
id: 0024
title: Steering rack rate and lock checked against a double lane change, and a source for both
status: ready
priority: P2
size: M
lens: authenticity
created: 2026-10-21
pr:
by: scout
---

## Why
Focus priority 1 (steering behaviour at the limit). The car is steer-by-wire with a ±170° yoke and a
variable ratio (docs/REVEAL_RESEARCH.md §3.5, OFFICIAL). In `vehicle.js` (lines ~593–603) the rack
rate is a bare 2.2 rad/s (126°/s at the road wheel) and parking lock a bare 0.5 rad (28.6°); neither
carries a source or ESTIMATE note, and the speed-sensitive lock is sized so that full stick asks for
exactly the tyres' peak grip. That is a tuning law, not a measured behaviour. Speed-dependent ratios
are standard in steer-by-wire: higher ratio near centre for stability, lower off centre for parking,
and sensitivity reduced as speed rises
(https://patents.google.com/patent/US6799105 ; https://odr.chalmers.se/items/861d2777-80f8-4c68-b2b9-f74489d59afa).
The honest check is a standard manoeuvre: ISO 3888-2 (the "moose test", double lane change) at 80
km/h, which a performance car with 1.25 g tyres passes with margin and which exposes both a too slow
rack (cone strikes) and a too fast one (yaw overshoot).

## What
- `src/sim/spec.js`: move `steerLock` (0.5, ESTIMATE: typical road-wheel lock ≈ 0.55–0.65 rad for a
  car this size, state the reasoning) and `steerRate` (ESTIMATE, justify against an electric rack's
  rack speed) out of vehicle.js, each tagged.
- `scripts/physics-bench.mjs`: an ISO 3888-2 lane-change driver (closed-loop, same inputs a player
  gives) at 60 / 80 / 100 km/h, reporting cones hit, peak yaw rate, peak lateral g and tail slip.
- Only change the numbers if the manoeuvre exposes a failure; otherwise the ticket lands as sourced
  constants plus the bench and a test. Say which in the PR.
- SIM_VERSION bump only if outcomes change.

## Acceptance criteria
- [ ] Both constants live in `spec.js` with a source or an ESTIMATE note and a range.
- [ ] The bench passes 80 km/h with no cone struck and peak lateral g ≤ 1.3 on the Assist and Pro tiers
      (fans off), and the report prints the numbers.
- [ ] Full-stick flick at 100 km/h does not spin the car (yaw overshoot ≤ 15 % of steady state).
- [ ] Right still means right (existing steering-sign tests pass); `naive-players` 32/32.
- [ ] 390×844 touch steering and 1280×720 keyboard steering feel unchanged in `human-phone.mjs`
      (landings % within 2 points).

## Test plan
New `tests/unit/lanechange.test.js` running the closed-loop manoeuvre in Node (deterministic) and
asserting the bands above. Re-run `physics-bench`, `naive-players`, `human-phone`.

## Out of scope
A yoke visual, steering feel on touch, speed-sensitive rack for Free Drive, active rear steer.
