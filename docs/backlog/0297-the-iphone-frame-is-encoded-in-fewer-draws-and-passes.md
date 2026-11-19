---
id: 0297
title: The iPhone frame is encoded in fewer draws, fewer state changes, fewer passes and less memory, and looks the same
status: shipped
priority: P1
size: M
lens: performance
created: 2026-11-18
pr: 446
by: operator
---

## Why
The owner (2026-11-18): "100x more performant", measured (0296). The baseline (docs/PERF-2026-11-18.md) put ≈ 240 draw calls
in a frame of the Show, a third of them in the shadow pass, where a parked car was drawn once per material although depth
doesn't care about materials. Each submesh set its pipeline, depth state, cull, bias and four textures again whether they
changed or not. On a phone MetalFX upscaled into a full-screen texture that a pass then copied, pixel for pixel, into the
drawable, and the shadow map was 32-bit for a box whose depth a 16-bit map resolves to 2 mm.

## What
- The shadow pass draws each mesh once: its opaque, lit submeshes' indices made absolute in one buffer, built the first
  time the mesh casts (the same triangles, so the same depth). Parked cars outside the key light's box aren't drawn into it.
- `drawMesh` sets a state only when it differs from the submesh before it.
- On a phone, MetalFX writes the drawable itself when the drawable allows it (the layer isn't framebuffer-only there):
  no copy pass and no 12.6 MB `upscaled` texture. The old path stays as the fallback (and the simulator never made it).
- The shadow map is depth16Unorm: 8 MB instead of 16, half the bandwidth; the shader's 0.0015 bias is a hundred steps.
- `sphereVisible` no longer builds an array a call.

## Acceptance criteria
- [x] Draws a frame fall on every scene (make perf, before and after in docs/PERF-2026-11-18.md)
- [x] Each look's screenshots match before and after (docs/shots/perf-2026-11-18/)
- [x] `make test` (52 run vectors) passes; the sim and the scorer are untouched

## Test plan
`cd ios && make test`; `make perf` before and after; screenshots of each look on the Show, the Wall and the Lineup at the
same moments (`-replay … -holds`), simulator only, muted, under /tmp/coldgas-sim.lock. A phone: `make device-bench-all`
(the owner).
