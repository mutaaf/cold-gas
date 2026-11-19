---
id: 0300
title: The iPhone title is up sooner at launch: the stage loads beside the pipelines, the renderer builds beside the title's flight
status: in-progress
priority: P1
size: S
lens: performance
created: 2026-11-18
by: operator
---

## Why
The owner (2026-11-18): measure cold launch to the first interactive frame and cut it. At launch three things ran one after
the other: the title's reference flight (the Swift sim on the main thread), then the course's renderer, which loaded the
stage (its JSON, meshes, 19 textures with mipmaps and the environment) and only then made its pipelines.

## What
- The title asks StageView to start building the course's renderer (`prepare`) before it flies the reference run, so the
  build runs on its own thread while the main thread flies. Switching course on the title gets the same overlap.
- `StageLoad`: the renderer loads the stage on another thread while it makes the pipelines, and waits only for what's left.
- `PIPELINES …` says how long the stage took beside them and how long the pipelines waited; `-perf` prints the title
  flight's time (`PERF-LAUNCH`).

## Acceptance criteria
- [x] `make perf`'s launch → first frame falls on the title (median of repeats) and nothing else changes
- [x] `make test` passes; the title's flight is the same flight (the sim stays on the main thread)

## Test plan
`cd ios && make test`; `make perf` (title, REPEAT=5) before and after; the `PIPELINES` and `PERF-LAUNCH` lines from a
launch on the simulator (muted); `make device-bench-all` on a phone, where a cold pipeline archive (the first launch after
an update) makes the overlap bigger (the owner).
