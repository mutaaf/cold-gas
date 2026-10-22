---
id: 0044
title: The resolution governor never shows a black frame and reads a 30 fps cap correctly
status: ready
priority: P1
size: M
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
- `setPixelScale` runs after the frame rendered (src/obs/heal.js ~132-137 → scene.js ~520-526), so the
  cleared canvas is presented: a black flash mid-run, on exactly the devices that are struggling.
- iOS Low Power Mode and Android battery saver run a steady 33.3 ms; with `LONG_MS = 25`
  (src/obs/frames.js ~10) every frame is "slow" and resolution steps down to 55 % with an idle GPU.
- The governor can only scale pixels, never shed effects (mirror, haze, SMAA, bloom size, shadows).
- Pixel ratio is read once at boot: moving to another monitor, browser zoom or Stage Manager never updates it.

## What
Queue the scale and apply it at the start of the next `render()`, preferably outside `live`. Judge frames
against the detected refresh cadence and the measured work time. Add effect steps to the ladder.
Re-read DPR on resize and on a `resolution` media query change.

## Acceptance criteria
- [ ] Forced governor step mid-run: the next presented frame isn't black (screenshot luma)
- [ ] Unit: 33.3 ms windows with 6 ms work → no step down
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Unit test on the governor decision (pure); e2e screenshot after a forced step.

## Out of scope
A user-facing quality menu.
