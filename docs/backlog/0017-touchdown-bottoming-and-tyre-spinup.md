---
id: 0017
title: Touchdown loads — suspension bottoming and tyre spin-up transient
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: scout
---

## Why
Focus priority 3 (landing physics). `vehicle.js` line 21 gives ≈16 cm of travel to the bump stop,
but landing sink beyond what that travel absorbs should show as a hard bump-stop hit (a load
spike, a body strike on the skirts) rather than a smooth spring. And wheels touch down not
rotating: a car landing at 20 m/s has to spin the tyres up from rest, giving a brief
longitudinal drag/skid (friction-limited by μ·Fz) and a chirp. Energy check: at 1.5 m/s sink,
½·2450·1.5² ≈ 2.8 kJ; over 0.16 m that is ≈17 kN average (≈0.7 g), at 4 m/s it is ≈ 6× that,
which exceeds the 4 tyres' static load by a wide margin and must bottom out. The judge's landing
score (`judge.js` `sinkS`) already bands sink; this ticket makes the physics honestly produce
the numbers behind it. Check the wheel's initial angular speed on release (should be the
freewheeling spin from the ramp, ≈ v/R at lift-off, decaying only by bearing drag).

## What
- `src/sim/vehicle.js`: a progressive bump-stop (stiffening spring over the last 2 cm, damped),
  so over-travel loads are visible in `run.t` (`peakSuspLoadG`, `bottomed` flag). Wheel angular
  velocity carries through flight (no reset), so touchdown slip is real; contact speed mismatch
  produces the friction-limited drag.
- `src/sim/run.js` telemetry + `damage.js`: a bottoming event of the 'tyre slam' kind past 3 m/s
  already exists; make bottoming at 2.5–3 m/s register as a suspension event, not a hull crush.
- HUD (post-flight sheet only): peak suspension load and "bottomed" flag.
- SIM_VERSION bump, CHANGELOG.

## Acceptance criteria
- [ ] Drop-test unit test: 1.0 m/s sink does not bottom; 2.5 m/s bottoms once; peak load grows
      monotonically with sink, matching the energy balance within 20 %.
- [ ] Touchdown with wheels spinning at v/R produces ≤ 0.2 g longitudinal transient; with wheels
      stopped it produces a μ·Fz-limited drag (unit test with a fixed landing speed).
- [ ] Reference Wall/Show/Lineup touchdowns do not bottom and keep their Integrity (≤ 2 % damage).
- [ ] `naive-players` 32/32; `human-show.mjs 300 assist --cues=new` ≥ 95 %; determinism IDENTICAL.

## Test plan
Unit drop tests (`tests/unit/`), results-sheet e2e check that the new field appears, existing gates.

## Out of scope
Tyre blowouts, rim damage, sound design for the chirp.
