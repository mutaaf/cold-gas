---
id: 0152
title: "Phase 1: the Swift sim flies every vector bit for bit (vehicle, world, run, judge)"
status: shipped
priority: P1
size: L
lens: platform
created: 2026-11-04
pr: 251
by: operator
---

## Why
0147 proved the two halves the port rests on (DMath and native Rapier are bit-exact with the web). Phase 1 of
docs/NATIVE.md is the sim itself: until the Swift core replays the 52 run vectors to the same bits and scores them
with the same card, nothing drawn on the phone can be trusted to score like the web.

## What
Runs on: the operator's Mac (the engine legs need the XCFramework; ColdGasCore's pure parts also test on Linux).
Port line for line under docs/NATIVE.md §3's porting rules, in this order, each step checked against the vectors
before the next: `m3`, `spec`, `courses` (Show, Wall, Lineup), `impacts`, `damage`, `world` (grow
ios/Vendor/Rapier/src/lib.rs's C API call for call with the TS bindings: convex hulls, cylinders, heightfield,
contact pairs and manifolds, collision events, sleeping, CCD, collision groups), `vehicle`, `run` (log packing,
`simulate`), `judge` (`scoreRun`), then `predict`, `coach`, `autopilot`, `hands`, `driving`, `onethumb`,
`challenge`.

First milestone (from 0147): the reference Show's first 240 ticks match `runs/ref-show.json`'s checks.

## Acceptance criteria
- [x] `RunVectorTests` replays every `runs/*.json` log with the Swift `simulate`: 52 of 52 match every 24-tick check,
      every full state and the final hash. On a miss it names the tick, the field and both bit patterns.
- [x] The flattened telemetry and `scoreRun`'s card match each vector's `telemetry` and `card` exactly (52 of 52).
- [x] SIM_VERSION is checked against the vectors' (`RunVectorTests`).
- [x] 0 B allocated per tick in `simulate` in an optimised build: 2 one-off blocks over 960 ticks of free flight
      (`make alloc`). A debug build boxes values the optimiser removes.
- [x] ColdGasCore's pure tests pass on Linux (DMath, HapticScore, layout). The sim itself needs the engine's
      XCFramework, so it runs on macOS, the simulators and the phone.
- [x] Extra: on an iPhone 15 Pro Max, Release build, `-selftest` gives `runs 52/52`, with the reference Show flown in
      59 ms. `-haptics demo` now flies the Swift sim, and its track is identical to the JS feed's (`NativeHapticsTests`).

## Test plan
swift-testing suites per module against the vectors (`swift test` on macOS, `xcodebuild test` on the Duo simulator,
the app's `-selftest` on a phone); the vectors themselves come from `npm run vectors`.

## Out of scope
Free Drive, the Sandbox, the rocket (v2). Rendering (phase 2).
