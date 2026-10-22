---
id: 0046
title: Switching course, coming back from Free Drive and the film look never pop or hitch
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
- `setCourse` builds the look and bakes the environment synchronously (scene.js ~446-458); each course has
  a different light set, so every material recompiles on the next frame: a freeze on a course click and on
  leaving Free Drive.
- Free Drive sets `camera.near=0.1, far=4000` (drive/index.js ~200) and never restores the stage's
  0.3/3000: the slab decals z-fight again for the rest of the session.
- Desktop: haze, vignette and the slab reflection switch on in one frame 1–3 s after the fade-in
  (scene.js ~612-623, film.js ~174-196).

## What
Build the other looks in idle slices after `stage.ready` and `compileAsync` each one, or keep one light rig
with intensities; save/restore near/far in Free Drive enter/exit; ease film uniforms from 0 over ~1 s.

## Acceptance criteria
- [ ] Max frame time across three course clicks < 50 ms on desktop (perf.mjs)
- [ ] flicker.mjs show-title after a Free Drive round trip equals a fresh boot's
- [ ] Screenshots at 0.5/2/4 s show the film easing in, no single-frame jump
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: camera.near/far after drive exit; perf.mjs long-task measurement around course clicks.

## Out of scope
New course looks.
