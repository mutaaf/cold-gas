---
id: 0045
title: Mist and crash smoke draw only live particles, at the right size on every screen
status: ready
priority: P1
size: S
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
Dead mist particles keep their last size (up to 4.55 m, hundreds of px near the camera) and are drawn
with alpha 0 (src/render/plumes.js ~136-152, vertex shader ~79); phones get the 1,800 pool. After a
landing burst hundreds of invisible sprites are shaded per frame, and three attribute buffers re-upload
every frame even on the title. Crash smoke repeats it (crash.js ~58-62). Sprite size scales with CSS
`innerHeight` while `gl_PointSize` is in buffer pixels, so mist is half size on retina and jumps at each
governor step.

## What
`gl_PointSize = 0.` and clip when `aAlpha <= 0.`; track live count and skip `needsUpdate` when zero;
900 on `mid`; size from `renderer.getDrawingBufferSize().y`, updated on resize/scale.

## Acceptance criteria
- [ ] `perf-show.mjs phone show`: p95 frame time over the 3 s after touchdown improves
- [x] Mist screenshot at DPR 1 and DPR 2 the same apparent size
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
perf-show numbers in the PR; a unit test that the pool reports 0 live after decay and skips uploads.

## Out of scope
New mist look.

## Progress (PR #68, 2026-10-21)
Done in #68: dead mist and smoke clipped with zero size, clouds hidden and uploads skipped when nothing is
alive (unit test), 900 on `mid`, a full pool waits for its oldest to fade (no visible overwrite), size from the
drawing buffer via `stage.onResize` (incl. governor steps); DPR 1 and 2 screenshots match.
**Still missing (criterion 1):** `perf-show.mjs` (now with a `touchdown` window) can't show a p95 gain on the
Metal dev rig: p95 sits at the 16.8 ms vsync floor before and after (render CPU p95 10.6→10.2 ms Show,
8.2→7.8 ms Lineup). Needs a real phone or a GPU-timer measure.
