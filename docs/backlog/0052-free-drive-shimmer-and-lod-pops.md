---
id: 0052
title: Free Drive and the endless road: no shimmering paint, no LOD pops
status: ready
priority: P2
size: M
lens: player-feel
created: 2026-10-21
pr:
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
- [ ] flicker.mjs `drive-road` and `endless-cruise` (0050): ground pops ≤ 10‰
- [ ] `perf-endless.mjs phone` unchanged within 5 %
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
flicker numbers before/after; shots-endless frames.

## Out of scope
New biomes.
