---
id: 0004
title: Recognise and reward trick variety — 720, flat spin, back-flip
status: ready
priority: P2
size: M
lens: content
created: 2026-10-19
pr:
---

## Why
The 360 roll is the reference. Mastery means going past it, and the scorer should name what
you did.

## What
In src/sim/judge.js, classify the dominant rotation axis from the accumulated body rates (roll,
pitch, yaw). Name the trick ("Barrel roll", "Double", "Back-flip", "Flat 360") and add a
difficulty factor to the Rotation category. Bump `SIM_VERSION` if outcomes change, and update the
results facts and the AI prompt facts.

## Acceptance criteria
- [ ] The autopilot with `rolls: 2` (when it lands clean) is named "Double" and outscores a single
- [ ] A pure pitch rotation is classified as a flip
- [ ] The reference jump score changes by under 1 point

## Test plan
Unit tests in tests/unit/sim.test.js for each classification.

## Out of scope
New input bindings.
