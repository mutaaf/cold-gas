---
id: 0011
title: A Show a person can learn to land, and Advanced per-thruster control
status: in-progress
priority: P0
size: L
lens: player-feel
created: 2026-10-20
pr:
by: operator
---

## Why
"The landing is hard." Measured: a model of human play (reaction time, keys, following the cues;
scripts/human-show.mjs) landed the Show clean 10 % of the time with Assist and never in Pro, and a
cue-following player on the live page hit the ground at ≈21 m/s every time. Experts want the
opposite end too: every valve by hand, rewarded by the panel.

## What
- Assist's flight computer tuned for a novice (src/sim/vehicle.js): a decisive LAND roll-out from
  inverted, a brake planned on the end-of-stop pressure, a line hold, envelope protection, crawl
  and carry limits. Pro is rate control without LAND. SIM_VERSION 11.
- Tiers from the flown inputs (src/sim/judge.js TIERS): Assist ×1, Pro ×1.08, Advanced ×1.15.
- Advanced: `manual` + ten valve channels in the input log (src/sim/run.js, src/worker verify),
  keyboard / gamepad / touch nozzle pad (src/valves.js, src/input.js).
- The landing HUD (src/sim/predict.js, src/hud-landing.js), practice drills (src/practice.js), the
  coach (src/sim/coach.js), the reference ghost, a pilot view (src/render/director.js).

## Acceptance criteria
- [x] Players who follow the cue or the HUD land the Show clean ≥ 95 % with Assist (human-show)
- [x] Reference runs within ±1 of SIM_VERSION 10; naive Wall 32/32, naive Show ≥ 46/54
- [x] An Advanced run replays bit-exactly and the Worker verifies it to the same card
- [x] Drills start anywhere with instant retry; not scored, never posted
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse
- [x] No frame-time regression (no per-frame allocations in the HUD)

## Test plan
tests/unit/learn.test.js (governor tuning, the predictor's calibration, the coach, drills, valve
channels, quantise/pack round trip, Advanced replay and Worker verify, tiers, the keyboard map) and
tests/e2e/learn.spec.js (drill start + R retry, the landing HUD, an Advanced key opens its nozzle,
the touch nozzle pad on a phone).

## Out of scope
Drills for the Lineup; per-valve gamepad remapping; a leaderboard per tier.
