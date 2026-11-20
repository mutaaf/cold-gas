---
id: 0351
title: No grass on the water: a clump stands only where every corner of its cell is dry
status: shipped
pr: 467
priority: P1
size: S
lens: player-feel
created: 2026-11-19
by: operator
---

## Why
Grass tufts stood on a river's surface and on its banks under the waterline (#465's real-river shot).

## Root cause
`cg_world_grass_vertex` (World.metal) asked one vertex of the 4 m cell under a clump whether it was water: the corner its
colour comes from. A river is 5–12 m wide, so a channel falls between the vertices, and a clump on the far side of the corner
stood in the water with a dry vertex under it. The baked surface (`surface`, 2 m texels: B wetness, A water depth) was read
for rock and snow only.

## What
- A clump is dropped when any of the cell's four corners carries the water (or slab) flag, when the baked surface has any
  water depth under it (`S.a > 0`: a lake, a river or the sea), or when it's on the soaked band at the water's edge
  (`S.b > 0.8`, ≈ the first 0.8 m above the level by `LandLook.wetness`).
- Trees, shrubs and rocks already refuse the water on the CPU (`Build.swift`: `g.y < g.water + 0.5`); unchanged.

## Acceptance criteria
- [x] No grass on a river, a lake or the sea, or on a bank below the waterline, in Real, Anime and 8-bit (docs/shots/0350/).

## Test plan
Simulator, each look: `-freedrive -fd-tod golden -fd-at -845,-3906,-69` (the river bank) and the lake at `-fd-at 3397,-1165,-135 -fd-cam cinema`, before and after (docs/shots/0350/).
