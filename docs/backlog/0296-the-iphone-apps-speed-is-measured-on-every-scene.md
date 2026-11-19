---
id: 0296
title: The iPhone app's speed is measured the same way on every scene and look, on the simulator and on a phone
status: in-progress
priority: P1
size: M
lens: performance
created: 2026-11-18
by: operator
---

## Why
The owner (2026-11-18): make the app "100x more performant", measurably, with every claim backed by numbers. The bench we had
(`make bench`, `-bench`) times the turntable in the tool panel only: no game UI, no run, no Free Drive, one look, no draw or
pass counts, no memory and no launch time. A change can't be judged against a baseline it can't reproduce.

## What
- `-perf <s>` measures the real game (UI, sim and all) after `-perf-wait <s>` and prints one `PERF` line, then quits: the
  display link's whole callback (p50/p95/p99), the renderer's encode, the main thread's busy ms per frame (SwiftUI included),
  draw calls, triangles and passes per frame, phys_footprint (average and peak), the GPU bytes every kept renderer holds,
  launch → first frame, and GPU time (meaningful on a phone only).
- Counted draws and passes: `RenderStats`, `MTLRenderCommandEncoder.tris`, `MTLCommandBuffer.pass` (Debug/Perf.swift).
- Scenes: title, a Show/Wall/Lineup run (autopilot), Roam, Free Drive (pilot 3 km out) and `cycle` (Free Drive in and out
  three times, then the title: what leaving keeps). Each look: Real, Anime, 8-bit.
- `make perf` runs the matrix on the "ColdGas iPhone" simulator (the lock, a private copy of the .app, `-mute`, shut down
  after); `make device-bench-all` the same on the paired phone; `scripts/perf-table.py` prints the table (`--base` for the
  change against a baseline). The baseline and the result live in docs/PERF-2026-11-18.md.

## Acceptance criteria
- [x] `make perf` prints the table for 3 looks × 7 scenes on the simulator
- [x] `make device-bench-all` builds Release once and prints the same table from a phone (the owner runs it)
- [x] The baseline on main is recorded in docs/PERF-2026-11-18.md
- [x] Nothing in a run changes: `make test` (52 run vectors) passes

## Test plan
`cd ios && make test`; `make perf` (simulator, muted, under /tmp/coldgas-sim.lock); `python3 scripts/perf-table.py` on its
output. The device leg is the owner's: `make device-bench-all`.
