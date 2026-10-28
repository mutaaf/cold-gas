---
id: 0108
title: The touchdown and the wreck fit a portrait phone's width
status: ready
priority: P1
size: S
lens: platform
created: 2026-10-28
pr:
by: critic
---

## Why
The touchdown is the payoff of the Show: four wheels down on the pad in a cloud. On an upright phone the
game draws it wider than the screen. Measured on production 3611051 (docs/critique/2026-10-28-0415.md). The
Show reference and the valves-shut crash were flown with real frames. The hero's projected box (every
visible mesh's bounding box, through `__coldgas.camera`) was sampled on every unique tick from touchdown
to the results:

| Viewport | Run | Frames | Box width / screen width | Share of the box on screen |
|---|---|---|---|---|
| 390×844 | reference | 10 | 1.26–1.32 | 0.76–0.79 (**10 of 10 under 0.9**) |
| 360×748 | reference | 11 | 1.21–1.27 | 0.79–0.81 (**11 of 11 under 0.9**) |
| 390×844 | crash | 17 | 1.27–1.45 | 0.69–0.79 (**17 of 17 under 0.9**) |
| 820×1180 | reference / crash | 10 / 16 | 0.84–0.87 | 0.98–1.00 |
| 844×390 | crash | 17 | 0.27–0.31 | 1.00 |
| 1440×900 | crash | 16 | 0.37–0.38 | 1.00 |

- `phone-7-touchdown.jpg` (390×844): the nose and the tail are cut off at both edges. The bottom 40 % of
  the frame is empty, dark pad.
- `phone-C-7-touchdown.jpg`: the wreck, upside down, is cut off the same way.

Cause: the landed rig (`src/render/director.js:229-234`) stands about 11 m from the car with a 40°
**vertical** FOV whatever the aspect. At 0.46:1 the horizontal FOV is about 20°, so about 4.0 m of width is
visible at 11 m. A side-on car is 4.65 m long (docs/REVEAL_RESEARCH.md §10.1, PHOTO). The air rigs already
correct for the HUD with keepClear (0063). The ground rig has no correction for aspect.

## What
- In `src/render/director.js` (the Show's and the Wall's landed rigs, and the crash's ground shot if it
  shares them): hold a **horizontal** framing on narrow screens. Either widen the FOV, or stand the camera
  back when `camera.aspect < 1`, so the car's projected width stays under about 0.8 of the screen.
  Keep the low, ahead-of-the-car composition.
- Desktop and landscape framing must not change: aspect ≥ 1 keeps today's numbers.
- No sim change.

## Acceptance criteria
- [ ] With the probe above (the hero's box through the camera on every tick from `t.touchTick` to
      `mode === 'results'`), the Show reference and the valves-shut crash (`S.autopilot` wrapped,
      zeros from release + 0.125 s, LESSONS 2026-10-27) each keep **≥ 0.95 of the box on screen in every
      frame**, with box width ≤ 0.85 of the screen, at 390×844, 360×748 and 820×1180.
- [ ] 1440×900, 1280×720 and 844×390 framing is unchanged: the same box width ±0.02 of the screen.
- [ ] The box stays out from under `[data-hud-box]` and `.top-actions` for more than 10 % of its area at
      390×844 (0063's rule, extended to the ground).
- [ ] Before/after screenshots of touchdown + 0.3 s at 390×844 (reference and crash) in the PR.
- [ ] `flicker.mjs --phone` regions for the show-* scenarios are not raised (flicker-budget).
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
Extend `tests/e2e/release-frame.spec.js`, or add a sibling spec, that keeps stepping the reference past the
touchdown with `liveStep` and the director, and asserts the box share and width at the viewports above.
Add a crash variant with the valves shut.

## Out of scope
The replay's cameras (0068), the air rigs (0063, 0107), and the foldables' shapes (0107; add them here only
if 0107 lands first).
