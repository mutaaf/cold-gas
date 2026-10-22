---
id: 0049
title: Easy on the battery: no full-screen blends while flying, an idle title that idles, no per-tick garbage
status: ready
priority: P1
size: M
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
- `.grain` covers the screen with `mix-blend-mode: overlay` during play (styles.css ~35), a full-screen
  blend at DPR 3 per frame; `backdrop-filter` blurs sit over a canvas that changes every frame (strip,
  cue, stick, buttons, the 24 px results sheet over the replay).
- The title renders the full stage at the display rate (120 Hz on ProMotion): heat for a still screen.
  The shadow map re-renders every frame even when nothing moves.
- Per sim tick (240 Hz): `Object.assign(out, newInput())`, `getGamepads()`, rest-arg helpers, a new
  `pedals` object, `KEYS.map().join()` in run.js: ~4–5k objects/s and regular GC pauses (invariant 6).

## What
Hide grain while live/replaying; solid semi-opaque fills instead of blur while live; render the idle
title at ~30 fps; shadow `autoUpdate` only when something moved; reset input objects in place, read pads
once per frame, compare packed inputs in place. Run `npm run determinism` (no outcome change, no bump).

## Acceptance criteria
- [ ] `node --expose-gc` bench: zero allocations per tick in input/hands/run hot path
- [ ] `ref-hash.mjs` fingerprints unchanged
- [ ] Title frames/s ≤ 31 when idle; live unaffected
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
An allocation bench script like `scripts/obs-bench.mjs`; ref-hash before/after; e2e counting rAF renders on the title.

## Out of scope
Changing sim behaviour.
