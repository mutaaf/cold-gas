---
id: 0001
title: Ghost of your best jump in the next attempt
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-10-19
pr:
---

## Why
Mastery needs a reference. Seeing a translucent ghost of your best run (or the reference jump)
beside you shows exactly where the burn was early or the roll was late.

## What
Store the best run's replay frames (Float32 per frame, the same layout as `run.frames`) in
IndexedDB, keyed by `SIM_VERSION`. During a live run, draw a translucent clone of the roadster
(a shared `MeshPhysicalMaterial` with opacity 0.18 and no shadows) at the ghost frame for the
current tick. Toggle it with `G`. Touches src/main.js, src/render/cars.js and a new src/ghost.js.

## Acceptance criteria
- [ ] After one finished run, the next run shows a ghost that moves in lockstep with ticks
- [ ] `G` toggles it, and the setting persists
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse
- [ ] No per-frame allocations

## Test plan
Unit: ghost frame lookup by tick (interpolation and clamping). E2E: after the reveal run, start
a jump and assert the ghost mesh is visible.

## Out of scope
Server-stored ghosts and other players' ghosts.
