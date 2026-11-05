---
id: 0161
title: "Phase 3's input layer: live stepping, one-thumb, classic touch and the aftermath in Swift, logging the web's bits"
status: shipped
priority: P1
size: M
lens: platform
created: 2026-11-04
pr: 253
by: operator
---

## Why
Phase 1 (0152) gave Swift `simulate(log)` and nothing that makes a log. A playable app has to turn touches into the
same input log the web writes, because production re-simulates the posted log: one channel a hundredth off and the
board's plausibility check, or the score, is about a different flight.

## What
Runs on: the operator's Mac (the engine's XCFramework).
Port into `ColdGasPhysics`, under docs/NATIVE.md §3's porting rules: `stepRun`, `logInput`, the quantisation and the
aftermath from src/sim/run.js (Live.swift); src/onethumb.js (OneThumb.swift); src/sim/predict.js for the pad's sight
(Predict.swift); src/hands.js, src/driving.js's scored-ground levels and src/input.js sample()'s touch path
(Hands.swift); main.js wallAssist and noteRelease as `LiveRun`. `npm run vectors` writes `input/*.json`: scripted
fingers on the page's own controls (input.js through the least DOM that binds it, scripts/vectors-dom.mjs).

## Acceptance criteria
- [x] `LiveInputTests` replays 15 touch timelines through `LiveRun`: the same input log entry for entry, a state hash
      every 24 ticks, the telemetry, the card, the sight where it was read, and the aftermath's end tick and resting
      state, in debug and optimised builds.
- [x] The timelines hold one-thumb hold / tap / hold / slide on the Show and the Wall; classic Pro on all three courses;
      Assist on Easy; Advanced on analog pedals and the nozzle pad; landings, crashes (`contact`, `flipped`) and a stall.
- [x] Each log replays through `simulate` to the same card, and the 52 run vectors still pass.
- [x] A live tick adds no heap blocks past one per log entry (`make alloc`).
- [ ] The app flies a run from real touches (ios/ColdGas, phase 3).

## Test plan
`npm run vectors -- --check`, `npx vitest run tests/unit/vectors.test.js`, `cd ios && make test && make alloc`.
