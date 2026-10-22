---
id: 0053
title: Faster first load on a phone: the physics starts downloading with the page
status: ready
priority: P2
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
