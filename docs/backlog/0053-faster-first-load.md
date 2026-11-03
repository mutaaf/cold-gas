---
id: 0053
title: Faster first load on a phone: the physics starts downloading with the page
status: ready
priority: P1
size: S
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
PART ONE SHIPPED 2026-11-03 (builder, #PRNUM): the WASM preload is gone. Measured (scripts/perf.mjs against dist served
gzipped like production, phone 4×CPU Slow 4G, medians of 3): usable 7,871 → 6,578 ms, first 3D frame 16,836 → 13,047 ms,
desktop unchanged, physics ready no later (≈ 44 s both, the 4×-CPU compile dominates). The waterfall showed why: the
preloaded 1.15 MB WASM shared the link with the entry from 0.6 s, so the 217 kB entry landed at 4.7 s, not 3.4 s.
What stays open for the next Builder: the main chunk (224 kB gzip) ≥ 20 KB smaller, and the light folding. Measured
per module in the entry: crash.js 9.1 kB gzip is the biggest title-irrelevant piece, but it adds meshes the stage
compiles in `stage.ready` and the wet slab mirrors (tagLook), so lazy-loading it needs a late compile + tag (flicker
gate); coach 4.6, instruments 3.5, share-card 2.9, practice 1.9 are the easy ones (≈ 13 kB, not 20). At 4×CPU the
entry's execution (≈ 3.2 s from landing to usable) now dominates; profile it before cutting bytes.

The Rapier WASM is 1.17 MB gzipped (~6.5 s on Slow 4G) and its fetch starts only after the main bundle
runs (sim/engine-web.js ~7, main.js ~48). First-load JS is ~280 KB gzipped and the main chunk carries
modules the title doesn't need (ai/settings, practice, panel, instruments). The Show/Wall carry ~10
dynamic lights on every tier.

GROOMED 2026-11-01: raised to P1 (stays proposed: the ready queue is over its cap of 10, so the Builder takes it once there is room); the operator's PLAYERS focus puts first load on a phone over cellular third (the build is 719 kB / 219 kB gzip main plus 66 kB gzip three.core, and the 1.17 MB WASM follows). Builder: say in the PR which of `visit-new` → `run` it should move.

GROOMED 2026-10-27: the WASM `<link rel="preload">` already ships (vite.config.js inlineCss plugin). What is open: shrink the main chunk by lazy-loading title-irrelevant modules (≥ 20 KB gzip) and the light folding on `low`/`mid`.

## What
~~A WASM preload~~ (measured harmful and removed, see the top); lazy-load the
title-irrelevant modules; on `low`/`mid`, fold uplights and red points into emissive decals.

## Acceptance criteria
- [x] `scripts/perf.mjs` (Slow 4G profile): "usable" time improves; first 3D frame no worse
- [ ] Main chunk gzip shrinks ≥ 20 KB
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
perf.mjs before/after in the PR; smoke e2e unchanged.

## Out of scope
A service worker.
