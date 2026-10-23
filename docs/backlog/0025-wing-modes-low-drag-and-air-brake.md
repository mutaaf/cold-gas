---
id: 0025
title: Rear wing has two modes — low-drag and high-downforce air-brake — with sourced CdA
status: proposed
priority: P2
size: M
lens: authenticity
created: 2026-10-21
pr:
by: scout
---

## Why
Focus priority 1/4 (honest car). docs/REVEAL_RESEARCH.md §3.6 (OFFICIAL): the biplane rear wing and
front wings have two aero modes, low-drag and high-downforce / braking, "up to 2 G of downforce
over 200 mph", ineffective below about 50 mph (where the fans fill the void), CdA ≈ 0.50–0.60 m²
low-drag (ESTIMATE) versus ≈ 0.9–1.2 m² in the high-downforce mode. The sim has one constant
`cdA: 0.55` (`spec.js` line 95) and no downforce term at all, so top-speed braking, the Free Drive
roads at 200+ km/h and the stability the real controller gets from the wing are all one number.
This also feeds the landing HUD: the flight brake in the air has an air-brake component the
reveal car has and ours lacks.

## What
- `src/sim/spec.js`: `cdA` low-drag 0.55 (kept) and `cdAHigh` 1.0 (ESTIMATE, range 0.9–1.2);
  `clAHigh` so that downforce is 2 g-equivalent at 89 m/s (200 mph) and scales with v² (OFFICIAL
  claim, §3.6; show the arithmetic in the comment). Mode switch speed ≈ 22 m/s (50 mph, OFFICIAL
  "aero ineffective below"), actuation time ≈ 0.3 s (ESTIMATE, actuators in §3.6).
- `src/sim/vehicle.js`: aero force uses the current mode; the mode follows a simple controller:
  high-downforce when braking hard or cornering above 40 m/s, low-drag on full throttle straights,
  low-drag in the air unless LAND/brake is commanded (air-brake). Downforce acts at an aero centre
  (ESTIMATE 0.45 L from the front) and loads the tyres through Fz.
- HUD: one word in the existing telemetry strip when the wing is up (WING / AERO BRAKE), no new
  colour.
- SIM_VERSION bump, CHANGELOG.

## Acceptance criteria
- [ ] At 89 m/s in high-downforce mode the aero downforce is 1.9–2.1 × weight (unit test, arithmetic
      shown); below 22 m/s it is under 5 % of weight.
- [ ] 100 → 0 km/h braking distance with the wing up is shorter than with it down at 200 → 100 km/h
      by the amount the drag difference predicts (±10 %); `physics-bench` prints both.
- [ ] Reference Wall / Show / Lineup scores change by ≤ 1 point (low-speed events are mostly unaffected).
- [ ] `naive-players` 32/32; `human-show.mjs 300 assist --cues=new` ≥ 95 %; no brand names.
- [ ] HUD wing word fits at 390×844 and 1280×720 without overlap (`hud-audit.mjs`).

## Test plan
`tests/unit/aero.test.js`: downforce vs speed, mode switch timing, drag in each mode. Re-run
`physics-bench`, `hud-audit`, naive sweeps.

## Out of scope
Wing animation (cosmetic, and focus is realism-only), Free Drive top speed tuning, active front
wing pivot angles.
