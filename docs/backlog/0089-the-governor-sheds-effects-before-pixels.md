---
id: 0089
title: The governor sheds effects before pixels
status: proposed
priority: P2
size: M
lens: performance
created: 2026-10-26
pr:
by: builder
---

## Why
0044 (#116) made the in-session governor's resolution steps invisible (no black frame) and stopped it
punishing a 30 fps cap. Its ladder can still only scale pixels, though: a struggling device loses
sharpness first while the mirror, the haze, SMAA, the bloom's size and the shadows keep costing the same.
On a fill-bound phone, dropping the wet slab's mirror or halving the bloom likely buys more than a 15 %
resolution step, and looks better for it. This was part of 0044's What and was split out, because it
changes what each tier looks like and needs its own flicker-budget pass.

## What
Interleave effect steps with the resolution steps in `createGovernor` (src/obs/ledger.js) and apply them
in src/render/scene.js / film.js through the same deferred `refit` (applied at the next render, never
between a draw and its presentation): e.g. 1.0 → mirror off → 0.85 → bloom half-res → 0.7 → shadows 1024 →
0.55. Measure each step's saving on `node scripts/perf.mjs` before choosing the order.

## Acceptance criteria
- [ ] Each effect step is measured (ms/frame saved at 390x844 phone profile and 1280x720) and the ladder is ordered by saving per visible cost
- [ ] No step presents a black frame (tests/e2e/governor.spec.js extended)
- [ ] flicker-budget passes for both screens with each effect step forced
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Unit: the governor's ladder order and hysteresis. e2e: each forced step draws the next frame.

## Out of scope
A user-facing quality menu.
