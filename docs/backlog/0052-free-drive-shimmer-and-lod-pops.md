---
id: 0052
title: Free Drive and the endless road: no shimmering paint, no LOD pops
status: shipped
priority: P2
size: M
lens: player-feel
created: 2026-10-21
pr: 140
by: operator
---

## Why
Road lines are hard `step()`s 10–12 cm wide that go sub-pixel past ~100 m and the asphalt noise isn't
filtered (src/render/roadlook.js ~221-238); the dusk glow `step(0.5, …)` feeds bloom. Endless tiles swap
LOD instantly (world/endless-world.js ~248-271), far trees vanish inside `hideR` (roadlook.js ~294-300)
and the spruce detail swap has no hysteresis (endless-world.js ~276-287).

## What
`fwidth`-anti-aliased lines faded by coverage; noise faded with distance; tile height blend near ring
edges or a 0.3 s dither fade; hysteresis on tree LOD radii.

## Acceptance criteria
- [x] flicker.mjs `drive-road` and `endless-cruise` (0050): ground pops ≤ 10‰
- [x] `perf-endless.mjs phone` unchanged within 5 %
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
flicker numbers before/after; shots-endless frames.

## Out of scope
New biomes.

## Shipped (builder, 2026-10-27)
- Road paint (src/render/roadlook.js `PAINT_GLSL`): every line and dash is its exact box-filtered coverage of the
  pixel's footprint (`cgLine`, `cgDash`; a dash pattern far away averages to its duty), the worn-paint threshold and
  the gravel shoulder's start are blurred over their own footprint, the asphalt grain's two fine octaves fade to
  their mean under a pixel, and the dusk glow follows the paint's coverage instead of `step(0.5, r)`.
- The endless world's detailed spruces swap with 32 m of hysteresis (src/world/lod.js `wantHi`).
- flicker.mjs `--gl=swiftshader`, main → branch on one machine (ground pops ‰): desktop drive-road 5.22 → 3.02,
  endless-cruise 6.89 → 5.71; phone drive-road 4.26 → 1.58, endless-cruise 4.71 → 3.64. No region rose; budgets
  lowered with `--write`. Heatmaps: docs/shots/0052/.
- `perf-endless.mjs phone cruise` on software GL (fragment-bound): frame p50 1317 → 1333 ms (+1.2 %).
- Left for later (not in the criteria): the tile height blend or dither at ring edges, and far trees collapsing
  inside `hideR` (the far-tree ring is #136's open question).
