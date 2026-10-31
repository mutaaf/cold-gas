---
id: 0119
title: The upright touchdown frames the car on a lit pad, not over 40 % black floor
status: ready
priority: P1
size: S
lens: platform
created: 2026-10-31
pr:
by: critic
---

## Why
The touchdown is the payoff of the Show: four wheels down on the pad in a cold-gas cloud. On an upright phone the
landed rig puts the car in the middle of the screen and fills the lower 40 % with floor that renders black. 0108 made
the car fit the width by widening the lens under an aspect of 0.9 (`lens()` in `src/render/director.js`). A
side-on shot at aspect 0.46 with a held horizontal lens has a very tall vertical field. The camera stands 1.25 m up
and looks at the car's height, so half that field is the unlit ground between the camera and the pad.

Measured on production `0856de8` (docs/critique/2026-10-31-0400.md), Show reference, 390×844 touch, DPR 2, real
frames. The metric is relative luminance per pixel (0.2126 R + 0.7152 G + 0.0722 B) of the JPEG, over the band
from 60 % to 100 % of the frame's height:

| Frame | Tier | Mean luminance, lower 40 % | Share of lower-40 % pixels under 12 |
|---|---|---|---|
| over the row, T+12.6 (`pdef-ref-4-over-row.jpg`) | default (`high`) | 75.5 | **0.000** |
| touchdown, T+14.6 (`pdef-ref-6-down.jpg`) | default (`high`) | 9.5 | **0.78** |
| touchdown, T+14.6 (`p-ref-6-down.jpg`) | `low` | 3.3 | **0.975** |
| valves-shut crash, T+15.2 (`p-crash-6-down.jpg`) | `low` | 1.5 | **0.994** |
| 2026-10-30 touchdown (`../2026-10-30-2200/p390-7-down.jpg`) | `low` | 3.2 | 0.974 |
| desktop 1440×900 touchdown (`d-ref-6-down.jpg`) | `low` | 7.2 | 0.93 |

The carry two seconds earlier shows the same ground lit (0 % black at the default tier). So the black comes from where
the landed camera points, not from the floor. The car's centre sits at 52 % of the screen's height. Everything under
≈ 62 % is black, which is 640 CSS px of an 844 px phone, at the moment the player has just stuck it. The 2026-10-30
critique carried this over "below a ticket's bar". It has now been read on two production builds and at both tiers,
so it is a defect. The lockdown asks for layout at every viewport.

## What
- `src/render/director.js`, the Show's landed rig (and the crash cut that shares `lens()`): when the aspect is under
  `LENS_ASPECT`, spend the extra vertical field on the scene, not on the floor at the camera's feet. Pick one:
  - lower the look target, or raise the camera a little, so the car sits in the lower half of the frame (≈ 60–65 %
    down) and the pad, the row and the lit launch complex fill the top, or
  - use a vertical lens offset (`camera.setViewOffset` / a shifted projection) so the horizon moves up without
    tilting the car.
- Keep 0108's width bar (the car ≤ 0.75 of the screen's width, ≥ 0.9 of its box on screen). Keep the touchdown's dip
  and punch-in, and keep the camera clear of the row and the Wall.
- No sim change. The desktop and landscape framings stay as they are (aspect ≥ 0.9 → unchanged).

## Acceptance criteria
- [ ] At 390×844 and 360×800 touch, default tier, Show reference: on real frames at touchdown + 0.3 s and + 1.0 s,
      **≤ 0.35** of the pixels in the lower 40 % of the frame are under luminance 12. Today: 0.78.
- [ ] Same frames at `?gfx=low`: ≤ 0.5. Today: 0.975.
- [ ] The valves-shut crash (autopilot `{ carry: 5 }`) at 390×844: its final frame meets the same bar as the
      reference at each tier.
- [ ] The car's projected box centre is between 50 % and 70 % of the screen's height on those frames, and 0108's
      bars still hold (`tests/e2e/phone-frame.spec.js` green).
- [ ] At 1280×720 and 1440×900 the landed rig's camera is unchanged (same position and target to 1 mm on the
      stepped probe).
- [ ] `hud-audit` and `title-audit` are clean. `flicker.mjs --phone` doesn't raise a region past
      `docs/flicker-budget.json`.
- [ ] Before/after shots at 390×844 (default tier and `low`) in the PR.

## Test plan
Extend `tests/e2e/phone-frame.spec.js`. Over the landed frames of the stepped flight, assert the car's projected
centre height band at 390×844 and 360×800. Add a pixel check on a `page.screenshot()` of the canvas region below
60 % (share under luminance 12). Unit: `lens()`'s new vertical offset is 0 at aspects ≥ `LENS_ASPECT`.

## Out of scope
Relighting the floor or adding fill lights. That is a look change, so it is a separate ticket if framing alone can't meet the bar. The replay's cameras. The
Wall's and the Lineup's landed shots unless they share the same code path.
