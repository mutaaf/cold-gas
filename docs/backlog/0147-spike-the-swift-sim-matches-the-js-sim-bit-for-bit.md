---
id: 0147
title: "Spike: dmath and one vehicle step in Swift, with native Rapier, match the JS sim bit for bit"
status: ready
priority: P1
size: L
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
docs/NATIVE.md's whole plan rests on one claim: a Swift port of the sim plus native Rapier gives the same bits as the
JS sim plus Rapier's WASM build. If it doesn't, a run flown on the phone scores differently from the same log on the
web and the Worker, challenge links break between them, and the plan changes (a shared Rust core instead). Prove it
before porting 6,700 lines.

## What
Runs on: the operator's Mac (Xcode 27.2, Swift 6.4), plus `swift test` in a Linux container.
- `ios/Packages/ColdGasCore` (Foundation only, Swift 6 tools, language mode v5) with `DMath.swift` ported line for
  line from `src/sim/dmath.js` under docs/NATIVE.md §3's porting rules.
- `ios/scripts/rapier.sh`: builds rapier3d 0.21.0 (`enhanced-determinism`) from crates.io source into an XCFramework
  (ios-arm64, ios-arm64-simulator, macos-arm64) and a Linux static lib, behind a minimal C API (world, rigid body,
  collider, step, pose read-back).
- The engine check: rebuild `scripts/engine-determinism.mjs`'s scenario through the C API and compare its pose
  stream with the WASM build's, bit for bit.
- One `vehicle.step` slice: the reference Show's first 240 ticks (drive phase) ported, checked against 0146's
  fingerprints.
- Check the `-O` build's disassembly of the dmath kernels for `fmadd`/`fmsub`/`fnmadd` (there must be none).

## Acceptance criteria
- [ ] `swift test` passes every `dmath.json` vector bit for bit on macOS arm64, on an iPhone simulator, on a physical
      iPhone (`make device`), and on Linux (x86_64 and arm64).
- [ ] Native Rapier's pose stream equals the WASM build's for the engine-determinism scenario on macOS and the
      iPhone, or the ticket records exactly where it first differs (tick, body, field, both bit patterns).
- [ ] The 240-tick drive slice matches 0146's fingerprints, or the first difference is recorded the same way.
- [ ] No fused multiply-add in the release build's dmath kernels (`otool -tv` output attached).
- [ ] A written verdict in docs/NATIVE.md §3: proceed with the Swift port, or switch to a shared Rust core, with the
      evidence.

## Test plan
XCTest/swift-testing in `ColdGasCore` reading the vectors; the same suite in `swift:6.4` Docker for Linux;
`make device` for the iPhone run.

## Out of scope
Any rendering (0148). The rest of the sim (phase 1).
