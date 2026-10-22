---
id: 0038
title: No shader can make a NaN pixel (plumes, wall, road paint, sky)
status: shipped
priority: P0
size: S
lens: tech-health
created: 2026-10-21
pr: 68
by: operator
---

## Why
LESSONS: "One NaN pixel is a flicker storm": the bloom smears it over the frame. The same pattern is
still in: src/render/plumes.js ~21,26 (`pow(1.-along,1.4)` with unclamped `vUv.y`; `pow(1.-abs(dot(vN,
vView)),1.6)` on un-normalized interpolants), src/render/wall.js ~593 (`pow(vUv.x,4.0)`),
src/render/roadlook.js ~228 (`pow(negative,2.0)`), src/render/scene.js ~38 (normalize of a zero vector
at the zenith). Jets fire in every run, and flicker.mjs has no scenario with jets firing.

## What
Clamp every base going into `pow`, `sqrt`, `normalize` where interpolation can push it out of range.
Add a `show-jets` scenario to scripts/flicker.mjs (the car in frame with valves open) and a
`grep`-style unit test that fails on `pow(` with an unclamped first argument in `src/render/**`.

## Acceptance criteria
- [x] flicker.mjs `show-jets` exists; its z-fight nudge poses never flip ≥ 400‰
- [x] The lint test passes and catches a planted `pow(1.-vUv.y, 2.)`
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
`tests/unit/shaders.test.js` scanning shader strings; flicker.mjs numbers in the PR.

## Out of scope
Rewriting shaders for looks.
