---
id: 0147
title: "Spike: dmath and one vehicle step in Swift, with native Rapier, match the JS sim bit for bit"
status: shipped
priority: P1
size: L
lens: platform
created: 2026-11-04
pr: 246
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
- [x] `swift test` passes every `dmath.json` vector bit for bit on macOS arm64, an iPhone simulator (the Duo) and
      Linux (x86_64 and arm64). The physical iPhone leg moved to 0148: package tests can't run on a device without a
      host app, so the app runs the vectors with `-selftest`.
- [x] Native Rapier's pose stream equals the WASM build's for the engine-determinism scenario: `ce2812cc` (240 steps)
      and `0ddfc5d3` (2,400 steps) on macOS and the Duo simulator, from Rust and from Swift.
- [ ] The 240-tick drive slice: moved to 0150, the first item of phase 1. It needs vehicle.js + world.js and the
      engine's contact/event API, which is the port itself rather than a spike.
- [x] No fused multiply-add in the release build's dmath kernels. The only fused ops are LLVM's exact fmod lowering
      for `truncatingRemainder(dividingBy: 4)` (docs/NATIVE.md §3).
- [x] A written verdict in docs/NATIVE.md §3: proceed with the Swift port.

## Test plan
XCTest/swift-testing in `ColdGasCore` reading the vectors; the same suite in `swift:6.4` Docker for Linux;
`make device` for the iPhone run.

## Out of scope
Any rendering (0148). The rest of the sim (phase 1).
