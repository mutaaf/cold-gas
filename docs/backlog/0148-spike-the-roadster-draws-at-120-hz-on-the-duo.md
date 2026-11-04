---
id: 0148
title: "Spike: the exported roadster draws in Metal at 120 Hz on the iPhone Duo, in every pose"
status: shipped
priority: P1
size: M
lens: platform
created: 2026-11-04
pr: 247
by: operator
---

## Why
The second half of the spike in docs/NATIVE.md: the look must come from the same procedural generators as the web
(one source for the car), and the app must hold the Duo's fold and the 120 Hz display from the first frame. Doing it
on one car is cheaper than finding out on the whole stage.

## What
Runs on: the operator's Mac.
- `scripts/meshes.mjs` (`npm run meshes`): run `src/render/roadster.js`'s geometry build in Node and write one binary
  mesh file (positions, normals, uvs, indices, material groups) to `ios/ColdGas/Resources/Meshes/` (generated).
- `ios/project.yml` (XcodeGen; the .xcodeproj gitignored), `ios/Makefile` (`up`, `test`, `sim`, `shots`, `bench`),
  a UIScene app with a `CAMetalLayer` view and `CAMetalDisplayLink` at up to 120 Hz,
  `CADisableMinimumFrameDurationOnPhone = YES`, the privacy manifest (35F9.1, CA92.1, C617.1).
- One forward pass: the roadster's clear-coat paint under the blue-hour key light, 4× memoryless MSAA, pipelines
  built at launch off the main thread into an `MTLBinaryArchive`.
- A fold-aware root view that reads `reservedRegions(kind: .division, options: .includeInactive)` on every
  `layoutSubviews` and puts the car on the leading panel (book), the top panel (tabletop) or the whole screen
  (closed); debug `-pose` / `-window` launch arguments.
- `-bench` prints `BENCH frames avg p95 hitches` for a 10 s turntable.

## Acceptance criteria
- [x] `make up` generates, builds, tests and launches on the `iPhone Duo` and `iPhone 18 Pro Max` simulators.
- [x] `make shots` writes the car on the Duo closed (466×678), book (951×669) and tabletop (669×951), and on the
      Pro Max. Book and tabletop are laid out with `-window` and an emulated fold, because the simulator can't move
      its hinge. Nothing is drawn across the fold band, and the 84 pt side bar is clear.
- [x] Frame cost within 8.3 ms with 0 pipeline compiles after launch. On the iPhone 15 Pro Max: presentation p95
      8.34 ms (120 Hz held), CPU 0.26 ms, GPU p95 6.9 ms. The simulator presents at 60 Hz whatever the app does.
- [x] A layout unit test locks 18-0's measured poses: window, insets, fold band and the panel rects
      (`FoldLayoutTests`, 7 tests).
- [ ] The car's silhouette against the web title's turntable: the side profile matches by eye (shots in the PR).
      A pixel comparison waits for the full look (phase 2).
- [x] Extra, from 0147: `-selftest` on the physical iPhone passes every vector.

## Test plan
`ColdGasTests`: layout from fold regions per pose; mesh loader round-trip against `meshes.mjs`'s manifest. Shots by
`ios/scripts/shots.sh` (readiness token file, timeouts on every simctl call).

## Out of scope
The stage, plumes, post effects (phase 2). Haptics (0149).
