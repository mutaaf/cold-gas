---
id: 0310
title: On the iPhone Free Drive's land goes on forever and looks real, in all three looks, from a cache the GPU fills once
status: shipped
priority: P1
size: L
lens: authenticity
created: 2026-11-19
pr: 463
by: operator
---

## Why
The owner, 2026-11-19: "we're still not really great at this landscape realism … Each object needs to be efficiently and
effectively made in a way where there's the most minimal amounts of re-renders, caching is considered … this has to be the
exemplary application that showcases how far we can push the metal framework, this level of infinite generation of
landscaping … realistic and realism across the real, anime, and 8-bit versions." Free Drive today: ≈ 330 MB of footprint and
≈ 1.9 M triangles a frame, props drawn a whole 512 m block at a time at the LOD of its nearest point, the land's detail
recomputed per pixel every frame (value noise), a painted dusk, no shadows from the trees. #365 (a physical sky, surfaces,
grass) went stale against the three looks and the renderer's rework.

Three tracks share the world (docs/NATIVE-FREEDRIVE.md §9): this one (LANDSCAPE: terrain, materials, vegetation, sky,
distance, the streaming and caching), WATER and MATTER. This ticket also writes the contract they build on.

## What
- The contract (§9): `FreeWorld.sample` / `water` (CPU), the tile cache with per-tile surfaces and MATTER's trace slots, the
  layer protocol, the bindings, `WorldShading.h`, `WorldMatter.h`.
- A heap-backed tile cache: slabs and surfaces made once when a tile enters (a compute bake of rock, snow, wetness, water
  depth), drawn from cache; a residency set.
- Props GPU-driven: one instance pool, a compute cull (frustum, distance, LOD per instance, the shadow box) into indirect
  draws; the near pool's CPU gather goes; trees sway; trees and the roadside cast shadows from a cached map.
- #365's physical sky (Hillaire LUTs, cached until the sun or the eye moves), its time of day and its surfaces, salvaged onto
  the three looks; the drawn looks' sky takes its colours from the same sun.
- Lakes and rivers carved into the land, reported by `FreeWorld.water` (asked for by WATER, #460).
- Signposts for the bake, the uploads and the cull; the perf summary reports the world's cache.

## Acceptance criteria
- [x] §9 committed and pushed early on `build/0310-the-land-goes-on-forever-and-looks-real`
- [x] `make test` passes (the 52 run vectors bit-exact) with the world's new tests
- [x] `make perf` (freedrive): footprint ≤ 250 MB (344 → 85, peak 218) and fewer triangles (1.85 M → 0.48 M); streaming at
      60 m/s adds no main-thread spike over a frame (max 2.2 ms). GPU on a phone: the owner's `make device-bench-freedrive`
- [x] Screenshots before/after of Free Drive in Real, Anime and 8-bit
- [x] #365 closed with a pointer to this PR, its landscape work credited

## Test plan
`cd ios && make test`; `make perf` with `SCENES="freedrive stream"` before and after, all three looks; simulator shots
(muted, the "ColdGas iPhone" simulator under its lock) of Free Drive in each look at the same spot; `make device-bench-freedrive`
on a phone (the owner).
