---
id: 0108
title: The touchdown and the wreck fit a portrait phone's width
status: shipped
priority: P1
size: S
lens: platform
created: 2026-10-28
pr: 170
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
      frame**, with box width ≤ 0.85 of the screen, at 390×844, 360×748 (also the flip phone's inner screen),
      382×580 (the book fold's cover in a tab) and 820×1180.
- [ ] The other foldable shapes keep the whole car on screen (share 1.00) and stay ≤ 0.85 wide: 669×871,
      466×498, 360×380, 424×360, 594×368, 800×300 (scripts/audit-plan.mjs FOLD / FLIP).
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
The replay's cameras (0068) and the air rigs (0063, 0107). (0107 landed first, so the foldables' shapes are
in the acceptance above.)

## Critic re-measure 2026-10-28 09:50
Not a bounce: 0108 hasn't shipped yet. Production `ca1c5bb`, after 0103–0107. This is 0063's stepped probe
extended past the touchdown: the hero's box at 30 fps from `t.touchTick` to the results. Reference and
valves-shut crash (docs/critique/2026-10-28-0950.md):

| Viewport | Box width / screen (ref · crash) | Min share on screen | Frames < 0.9 |
|---|---|---|---|
| 390×844 | 1.23–1.32 · 1.17–1.38 | 0.76 · 0.73 | 53/53 · 60/60 |
| 360×748 | 1.18–1.26 · 1.13–1.32 | 0.79 · 0.76 | 53/53 · 60/60 |
| 382×580 | 0.86–0.93 · 0.81–0.94 | 0.94 · 0.98 | 0 |
| 820×1180 | 0.81–0.88 · 0.78–0.92 | 0.97 · 1.00 | 0 |
| 669×871 | 0.74–0.79 · 0.71–0.83 | 1.00 | 0 |
| 466×498 · 360×380 · 424×360 | 0.45–0.68 | 1.00 | 0 |
| 1440×900 · 1280×720 · 844×390 · 594×368 · 800×300 | 0.20–0.40 | 1.00 | 0 |

The fix is still the same: hold a horizontal framing when the aspect is narrow. Every shape at aspect
≥ 0.75 already fits.

## Shipped (2026-10-30, builder)
`src/render/director.js` `lens()`: under aspect 0.9 the landed rig (40°) and the crash cut (42°) hold the horizontal
lens they have at 0.9 (tan(v/2) × 0.9 / aspect); at 0.9 and wider nothing changes. The camera doesn't move, so the
low, ahead-of-the-car composition stays and it can't be walked into the row or the Wall. `tests/e2e/touchdown-frame.spec.js`
(0063's stepped probe from `t.touchTick` to the results, reference and valves-shut crash): before → after, box width / screen,
min share on screen:

| Viewport | Reference | Crash |
|---|---|---|
| 390×844 | 1.23–1.32, 0.76 → 0.66–0.77, 1.00 | 1.02–1.18, 0.85 → 0.53–0.59, 1.00 |
| 360×748 | 1.18–1.27, 0.79 → 0.66–0.76, 1.00 | 0.98–1.14, 0.88 → 0.53–0.59, 1.00 |
| 382×580 | 0.86–0.93, 0.94 → 0.66–0.72, 1.00 | 0.72–0.83 → 0.53–0.60, 1.00 |
| 820×1180 | 0.82–0.88, 0.97 → 0.66–0.71, 1.00 | 0.68–0.78 → 0.53–0.60, 1.00 |
| 669×871 | 0.74–0.79 → 0.66–0.70, 1.00 | 0.62–0.71 → 0.53–0.60, 1.00 |
| 466×498 · 360×380 · 424×360 · 594×368 · 800×300 · 844×390 · 1440×900 · 1280×720 | unchanged (aspect ≥ 0.9) | unchanged |

No frame at 390×844 had more than a tenth of the box under a HUD box or the top bar. The phone flicker probe runs at
844×390 (aspect ≥ 0.9, the lens untouched), so flicker-budget can't move.
