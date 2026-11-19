---
id: 0299
title: On the iPhone a course left behind lets go of its frame-sized memory, Free Drive shares the Show's set, and dents copy only what they dent
status: in-progress
priority: P1
size: M
lens: performance
created: 2026-11-18
by: operator
---

## Why
The owner (2026-11-18): reduce peak memory, meshes kept twice, and stop the Free Drive world leaking when you leave it.
StageView keeps one renderer per course so coming back is instant, but each kept everything while it waited: its HDR and
LDR frames, the resolved depth, the mirror, bloom's chain, MetalFX's output and its own 2048² shadow map (≈ 40–60 MB a
renderer), and its last track, which for a drive is the whole drive, a tick at a time. Free Drive and a roam on the Show
stand on the Show's set and loaded a second copy of it. Dents copied every course's roadster and parked row the first frame,
dented or not.

## What
- `Renderer.idle()` (StageView.show, when another course's renderer takes over): the frame-sized targets, the shadow map,
  the MetalFX scaler and the track go, the dents are put back; the next frame drawn makes them again (ensureTargets).
- `Stage.shared`: one Stage per set while any renderer holds it (Show, Free Drive and a roam on the Show share one).
- `Dents` copies a mesh's pristine vertices the first time it's dented, not at the first frame.

## Acceptance criteria
- [x] `make perf`'s `cycle` scene (Free Drive in and out three times, then the title) holds less Metal memory and footprint
- [x] The title, a run, Roam and Free Drive draw as before (screenshots), and a dent still comes back out on a new run
- [x] `make test` passes

## Test plan
`cd ios && make test`; `make perf` before and after (`cycle`, `freedrive`, `title`); a crash run then Retry on the
simulator (muted) to see the dents restored; `make device-bench-all` on a phone (the owner).
