---
id: 0153
title: "Phase 2: the Show drawn in Metal (stage, row, plumes, director), with headroom at 120 Hz"
status: ready
priority: P1
size: L
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
Phase 1 (0152) made the native sim the web's, bit for bit, and the spike (0148) drew the car alone at 120 Hz. That
measurement is the warning: the car alone took 6.6 ms of GPU at full resolution with 4× MSAA on an iPhone 15 Pro Max,
of an 8.3 ms frame. The whole stage (the Wall, the row, the complex, the plumes and mist, the film look) has to fit
in the same budget, so MetalFX and the resolution governor come with it, not after.

## What
Runs on: the operator's Mac (Xcode, Metal). docs/NATIVE.md §4.
- `scripts/meshes.mjs` exports the rest of the stage from the web's own generators: the Wall's deck and truss
  (src/render/wall.js), the parked row (src/render/parked/), the complex, the pad's rings.
- Metal passes: cascaded shadows, the floor reflection, the plumes (shock diamonds) and mist as compute, the film look
  (bloom, tone, grain).
- The director's rigs, from src/render/director.js, holding the horizontal lens.
- The car drawn from the Swift sim's state between ticks (interp.js), at 120 Hz.
- MetalFX temporal upscaling and the resolution governor: judged against the display's cadence, pixels first
  (src/obs/ledger.js's rules); thermal state and Low Power Mode feed it.

## Acceptance criteria
- [ ] The reference Show replays on the Pro Max at 120 Hz with presentation p95 ≤ 8.34 ms and GPU p95 ≤ 6.5 ms
      (`-bench -replay ref-show`).
- [ ] 0 pipeline compiles after launch; the binary archive covers every pass.
- [ ] Shots of the same moments as scripts/shots-look.mjs (title, release, landing) beside the web's, on the Pro Max
      and the Duo poses.
- [ ] `thermalState >= .serious` steps resolution down without dropping the frame rate.

## Test plan
`-bench` lines on the phone recorded in the PR; `make shots`; the layout and mesh tests stay green.

## Out of scope
Input, HUD, audio (phase 3). Free Drive (v2).
