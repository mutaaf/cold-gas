---
id: 0055
title: The descent tape's BRAKE label never draws over the ground label
status: ready
priority: P1
size: S
lens: accessibility
created: 2026-10-21
pr:
by: operator
---

## Why
Found while making the HUD audit green (0033, #71): near the ground the descent tape's BRAKE line label
draws on top of the "0 ft" label (src/hud-landing.js), so the two most important numbers in the last
second of a landing are unreadable together.

## What
In src/hud-landing.js, keep a minimum gap between the BRAKE label and the ground label: slide BRAKE's
label to the far side of its tick or clamp it above the ground label's box; the tick itself stays true.

## Acceptance criteria
- [ ] `hud-audit` brake and touchdown frames show no overlap between tape labels at any viewport
- [ ] BRAKE's tick position is unchanged (only its label moves)
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Extend `scripts/hud-audit.mjs` overlap pairs with the tape labels; e2e asserting the two label rects
don't intersect with the car held 1 m above the pad.

## Out of scope
Predictor logic (src/sim/predict.js).
