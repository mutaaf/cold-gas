---
id: 0023
title: The car coasts down like a real one — rolling resistance and a speed-dependent tyre drag
status: ready
priority: P1
size: S
lens: authenticity
created: 2026-10-21
pr:
by: scout
---

## Why
Focus priority 1 (tyre behaviour). `src/sim/vehicle.js` has aero drag (`cdA` 0.55 m², line ~837) but
no rolling resistance at all: a grep of `src/sim/` for rolling resistance, Crr or coast finds nothing.
A lifted-throttle roadster therefore coasts further than any road car, and the approach to the Wall
and Lineup (where the player lifts and brakes by feel) is slightly easier than the real thing. A
road-load model is cheap and standard: F_rr = Crr·N, with Crr ≈ 0.010–0.015 for low-profile
high-performance tyres (the tyre is a major share of road load; Crr also rises with speed).
General background: tyre rolling resistance is roughly proportional to load over a limited range and
varies nonlinearly with speed, with aero dominating at sustained high speed
(https://evkx.net/dictionary/rolling-resistance ; https://journals.sagepub.com/eprint/JQYYDAJXB4QNBWERTWYV/full).
The exact coefficient for 295/30 R20 / 335/30 R21 is not published: tag it ESTIMATE with the range.

## What
- `src/sim/spec.js`: `crr: 0.012` (ESTIMATE, range 0.010–0.015, low-profile track-biased tyres) and
  `crrSpeed` (growth per m/s, ESTIMATE, small); note in the comment that no source gives this size.
- `src/sim/vehicle.js`: per grounded wheel, a longitudinal drag of Crr(v)·Fz opposing wheel travel,
  zero at standstill (use the same stiction guard the tyres use so a parked car does not creep). Fan
  suction load counts in Fz (more load, more drag).
- Add a coast-down measurement to `scripts/physics-bench.mjs` (100 → 50 km/h, throttle 0, brake 0).
- SIM_VERSION bump, CHANGELOG, regenerate replay fixtures.

## Acceptance criteria
- [ ] Coast-down 100 → 50 km/h with no input, fans off, on level concrete takes between 14 and 26 s
      (road-car range for CdA 0.55, mass ≈ 2.4 t; the bench prints the number and the derivation).
- [ ] A car parked on a 1 % grade does not creep, and one on the level at 0.2 m/s stops within 3 m.
- [ ] Reference Wall / Show / Lineup scores change by ≤ 1 point (else the run-up needs retuning and the
      ticket says so).
- [ ] `physics-bench` 0–60 and braking within 2 % of today; `naive-players` 32/32; `human-show.mjs 300
      assist --cues=new` ≥ 95 %.
- [ ] `SIM_VERSION` bumped; every new number tagged ESTIMATE with its range.

## Test plan
`tests/unit/vehicle.test.js` (or a new `roadload.test.js`): coast-down time band, no-creep on 1 % grade,
rolling drag proportional to load (fan on doubles it within 20 %). Re-run physics-bench.

## Out of scope
Regenerative braking, motor drag torque, wheel bearing losses, temperature effects.
