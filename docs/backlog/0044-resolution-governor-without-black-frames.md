---
id: 0044
title: The resolution governor never shows a black frame and reads a 30 fps cap correctly
status: shipped
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
- [x] Forced governor step mid-run: the next presented frame isn't black (screenshot luma)
- [x] Unit: 33.3 ms windows with 6 ms work → no step down
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Unit test on the governor decision (pure); e2e screenshot after a forced step.

## Shipped
- A step only marks the stage `refit`; the next `render()` resizes and draws in the same task, so the cleared
  buffer is never presented (tests/e2e/governor.spec.js reads the canvas back in the frame the step is taken:
  luma 0 before, the drawn scene after, at 1280x720 and 390x844).
- src/obs/frames.js judges each 2 s window at its close against the window's own cadence (10th-percentile
  interval): a frame is slow past 25 ms AND past 1.25 × the cadence, or past 25 ms with ≥ 60 % of it CPU work.
  A steady 33.3 ms with 6 ms of work steps nothing; a 60 Hz panel dropping frames still steps down.
- The device pixel ratio is compared every frame in `render()` (headless Chromium never fires the
  `resolution` media query's change under an override, so a listener alone couldn't be tested), and a change
  refits the buffer the same way.
- The step lands on the next frame even mid-run (not deferred until outside `live`): with no black frame,
  the only cost left is the reallocation.
- Not done: effect steps on the ladder (mirror, haze, SMAA, bloom size, shadows). That changes what each
  tier looks like and needs its own flicker-budget pass; it should be its own ticket.
- Trade-off: a GPU-bound device that sits on a steady 33.3 ms with light CPU work reads like a 30 fps cap
  and is no longer stepped down. JavaScript can't see GPU time, so the two can't be told apart.

## Out of scope
A user-facing quality menu.
