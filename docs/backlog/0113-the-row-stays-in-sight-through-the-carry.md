---
id: 0113
title: The parked row stays in sight through the carry, above the HUD, on a landscape phone and the desktop
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-28
pr:
by: critic
---

## Why
The stunt is the carry over the parked row. On a landscape phone, the row being cleared spends most of the
crossing behind the HUD's bottom band. The car flies over an obstacle the player can't see. On the desktop,
the start of the crossing does the same thing behind the telemetry strip.

0063's probe checks the car and asks only that *a* roof be in frame. 0112's cover probe measures the car's box.
Neither one measures the row, so both pass while the row is hidden.

Measured on production `b07c30d` (docs/critique/2026-10-28-2140.md). The method is 0063's stepped flight
(`tests/e2e/frame-probe.js`: the Show reference, `liveStep` + the director at 30 fps). Each air frame
projects each parked body's box (`S.run.car.world.bodies`: footprint × 0…h) through `__coldgas.camera`. It
then takes the share of those boxes' pixels under any visible `[data-hud-box]`, `[data-hud-toggle]` or
`.top-actions` rect. The crossing is the car from 6 m before the row's front (z −10) to 2 m past its back
(z −22.6), 68 frames, after the locked-off hold (19 frames, row off screen by design):

| Viewport | Worst | Mean | Frames ≥ 50 % covered | At car z −13.7 (mid-row) |
|---|---|---|---|---|
| 844×390 touch | **91 %** | 40 % | **35 / 68** | 91 % |
| 667×375 touch | **94 %** | 42 % | **36 / 68** | 89 % |
| 740×360 touch | **97 %** | 42 % | **36 / 68** | 92 % |
| 932×430 touch (loose box) | 83 % | 35 % | 28 / 68 | 71 % |
| 1180×820 touch (loose box) | 61 % | 16 % | 7 / 68 | 33 % |
| 1440×900 keyboard | **66 %** | 18 % | 15 / 68 | 47 % |
| 1280×720 keyboard (loose box) | 75 % | 21 % | 15 / 68 | 42 % |
| 390×844 touch | 0 % | 0 % | 0 / 68 | 0 % |

"Loose box" rows used the row's single union box, which overstates a little. The others use each body's
own box.

Real frames on production show the same thing:
- `docs/critique/2026-10-28-2140/phone844x390-4-release.jpg` (T+11.2, `05 CARRY`): only the roofs show,
  through the N₂ cell. The rest of the row is under the strip. The car is a small shape at the top, with
  ≈ 60 % of the frame empty concrete and sky between them.
- `phone844x390-5-row.jpg` (T+12.1): the row's bays and the bottom third of the vehicles are behind the
  `T +00:12.1 05 CARRY` tab.
- `desk1440x900-4-release.jpg` (T+11.3): only the Semi's roof stands above the telemetry strip. The rest of
  the row is under it, and the top 55 % of the frame is sky.

The carry camera (`src/render/director.js:229-232`) aims at `carPos.y * 0.55 + 0.8` with a 54° FOV. That
puts the car near the middle and the row on the screen's bottom edge, which is exactly where the landscape
HUD docks. The portrait phone passes only because its HUD is at the top.

## What
- In `src/render/director.js`, the Show's tracking carry (`st.shot === CARRY`): compose the car and the row
  inside the region the HUD leaves. Two ways to do it:
  - a lens shift (`camera.setViewOffset`, as 0068 did for the replay) so the frame's optical centre sits at
    the centre of the screen above the bottom HUD band, or
  - aim lower / stand further back while the car is over the row.
  Read the band's top from the DOM once per resize, as `keepClear` does with its clearances, not per frame.
- Keep 0063's other rules: the car stays below the top HUD, the hold stays locked off (no pans: the flicker
  lessons of 2026-10-27), and 1440×900's and the portrait phone's car framing don't get worse.
- No sim change.

## Acceptance criteria
- [ ] With the probe above, while the car is over the row (car z from −9 to −22.6, after the hold's cut), no
      more than **25 %** of the parked bodies' projected pixels are under a HUD rect in any frame. Measure at
      844×390, 667×375, 740×360, 932×430 and 1180×820 touch, and at 1440×900 and 1280×720 keyboard.
- [ ] 390×844 and the foldables in `scripts/audit-plan.mjs` FOLD / FLIP stay at or under 25 % too (390×844
      is 0 % today).
- [ ] `tests/e2e/release-frame.spec.js`'s existing assertions still pass at every view it flies (car below
      the top HUD, ≤ 10 % of the car's box covered on touch, a roof in frame over the row).
- [ ] Before/after real-frame screenshots at car z ≈ −12 and −16 at 844×390 touch and 1440×900 keyboard in
      the PR.
- [ ] `flicker.mjs --only=show-live-jets` (desktop and `--phone`) not raised past `docs/flicker-budget.json`,
      measured against main on the same machine (LESSONS 2026-10-27, 0063).
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
Add the row-cover measure to `tests/e2e/frame-probe.js`'s `fly()` (each body's projected box against the HUD
rects, per air frame while the car is over the row). Assert it in `release-frame.spec.js` and its foldable
sibling at the viewports above, with the 25 % bound.

## Out of scope
The ground shot after touchdown (0108). The replay's rigs (0068). The HUD's own layout (0112: this ticket
moves the picture, not the instruments).
