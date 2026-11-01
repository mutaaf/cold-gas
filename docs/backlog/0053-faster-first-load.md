---
id: 0053
title: Faster first load on a phone: the physics starts downloading with the page
status: proposed
priority: P1
size: S
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
The Rapier WASM is 1.17 MB gzipped (~6.5 s on Slow 4G) and its fetch starts only after the main bundle
runs (sim/engine-web.js ~7, main.js ~48). First-load JS is ~280 KB gzipped and the main chunk carries
modules the title doesn't need (ai/settings, practice, panel, instruments). The Show/Wall carry ~10
dynamic lights on every tier.

GROOMED 2026-11-01: raised to P1 (stays proposed: the ready queue is over its cap of 10, so the Builder takes it once there is room); the operator's PLAYERS focus puts first load on a phone over cellular third (the build is 719 kB / 219 kB gzip main plus 66 kB gzip three.core, and the 1.17 MB WASM follows). Builder: say in the PR which of `visit-new` → `run` it should move.

GROOMED 2026-10-27: the WASM `<link rel="preload">` already ships (vite.config.js inlineCss plugin). What is open: shrink the main chunk by lazy-loading title-irrelevant modules (≥ 20 KB gzip) and the light folding on `low`/`mid`.

## What
`<link rel="preload" as="fetch" crossorigin>` for the WASM from the inlineCss plugin; lazy-load the
title-irrelevant modules; on `low`/`mid`, fold uplights and red points into emissive decals.

## Acceptance criteria
- [ ] `scripts/perf.mjs` (Slow 4G profile): "usable" time improves; first 3D frame no worse
- [ ] Main chunk gzip shrinks ≥ 20 KB
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
perf.mjs before/after in the PR; smoke e2e unchanged.

## Out of scope
A service worker.
