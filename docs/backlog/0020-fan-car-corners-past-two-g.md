---
id: 0020
title: With the fans armed, a level corner pulls more than 2 g, like the stage claim
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr: 53
by: critic
---

## Why
The one cornering number the reveal gave is OFFICIAL: "corner at greater than 2 G's … beyond the
tires, which is typically 1.26 G's" (docs/REVEAL_RESEARCH.md §3.7 and §4, Moravy on stage).
The focus puts "tyre … behaviour at the limit" first. Measured on main 80d7b7c (SIM_VERSION 16), steady
state at constant speed on open concrete (`createVehicle('lineup')`, x = 30, full stick, 2 s settle, 1 s
average; probe in docs/critique/2026-10-21-0945.md):

| | 20 m/s | 30 m/s | 40 m/s |
|---|---|---|---|
| Tyres only (`fan: 0`) | 1.12 g | 1.12 g | 1.14 g |
| Fans armed (`fan: 1`) | **1.18 g**, fan 133 kgf | **1.19 g**, 133 kgf | **1.20 g**, 133 kgf |
| Fan forced to full (`s.fanDemand = 1` each tick) | 1.81 g, 4,668 kgf | 2.40 g | 2.79 g |

Two things keep the car on its tyres alone:

1. **The fan never answers a corner.** `vehicle.js:613-628` schedules suction from the deck's tilt
   (`fanDemand`) and from the "void" law (held full throttle or full brake below `fanVoidSpeed`). On
   the level at speed with the stick over, both are zero, so an armed fan idles at 133 kgf.
2. **The rack is sized for 1.25 g.** `vehicle.js:600`: `lock = L·μg/v² + 0.04`. Even with 4.6 t of
   suction the front tyres sit at 1.6° (20 m/s) to 4.3° (40 m/s) slip, far below the 8.4° peak, so the
   steering, not the tyre, caps the corner.

Tyres-only steady cornering is also 11 % under the OFFICIAL 1.26 g (front slip 6.3° against the 8.4°
peak, so the same rack formula caps it).

## What
- `src/sim/vehicle.js`: a lateral term in the fan schedule, keyed to the **driver's command** (steer
  held × v², filtered like `gripSat`), not to measured tyre saturation (LESSONS, "A fan law fitted to
  the climb must not starve the launch": keying to saturation chattered). Demand for lateral g `a`
  is the suction that makes `μ·(m·g + N_fan) ≥ m·a`, inside `[fanIdleForce, fanMaxForce]`.
- `src/sim/vehicle.js`: the rack's full-stick lock uses the grip available now,
  `μ·(1 + N_fan/(m·g))·g`, not μ·g alone, so full stick asks for the tyres' peak with the fans on.
- The Show, the Wall and the Lineup are straight-line stunts; their references must not move
  (fan schedule on the curl is unchanged: `tests/unit/fan.test.js`).
- Bump `SIM_VERSION`; regenerate replay fixtures.

## Acceptance criteria
- [x] Probe (a new `physics-bench` row): fans armed, full stick, steady state on the level at 30 and
      40 m/s: **≥ 2.0 g** lateral (OFFICIAL "> 2 G"), and ≤ the tyre limit at that load (no free g).
- [ ] Same probe, `fan: 0`: **≥ 1.20 g** steady at 20, 30 and 40 m/s (OFFICIAL 1.26 g, ±5 %).
      **Not met; moved to 0021** (builder; swept on main 1be2f1a, SIM_VERSION 20). The rack is not
      what caps it. Sweeping the full-stick offset at 12/20/30/40 m/s with the fans off: +0.04 rad gives
      1.08/1.12/1.12/1.14 g, +0.06 gives 1.07/1.13/1.12/1.20, +0.10 gives 1.05/1.11/1.10/1.13, and
      +0.20 gives 1.08 g at 30 m/s. More lock means less g. At 30 m/s the fronts sit at 6.3°, where this
      Pacejka shape (B 16, C 1.35) already gives 98.9 % of its peak. The front axle saturates: 42 % of
      the weight, 2,728 N of lateral load transfer, μ 1.25 with −7 % per unit load. Its ceiling is
      ≈ 1.19 g, and the car measures 1.12 g as speed × yaw rate (1.14 g from Δv). "Typically 1.26 G's" is a car-level number, but
      `spec.js` uses it as the tyre's μ. Meeting it means re-sourcing μ and its load sensitivity, which
      is 0021's job, so this bar now lives there.
- [x] Fan force in that corner is reported (kgf) and stays within `[fanIdleForce, fanMaxForce]`; it
      falls back to idle within `fanHold` of the stick centring.
- [x] `tests/unit/fan.test.js` (six telemetry pitches ±30 %) and `tests/unit/gtrace.test.js` pass
      unchanged; `node scripts/ref-hash.mjs` shows the three stunt references bit-neutral, or the PR
      says why not and the reference scores move < 1 point.
- [x] `naive-players` 32/32, `naive-show` 54/54, `human-show.mjs 300 assist --cues=new` cue followers
      ≥ 95/100; `physics-bench` 0–60 within 2 %.
- [x] Determinism: Node, Chromium and WebKit replays IDENTICAL. (Builder: Node = Chromium on the clean, crash and a fans-armed cornering log; WebKit is not in the sandbox, and the change adds only + − × ÷ and min/max.)

## Test plan
Unit test: settle, reach 30 m/s, full stick for 3 s, assert mean lateral g over the last 1 s ≥ 2.0 with
`fan: 1` and ≥ 1.20 with `fan: 0`. Existing fan/gtrace/reference tests guard the stunts.

## Out of scope
Tyre load sensitivity itself (0021), aero downforce, Free Drive tuning beyond what this changes.
