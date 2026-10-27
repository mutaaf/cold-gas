---
id: 0063
title: The drop off the ledge stays in frame, clear of the top bar and the timeline
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 129
by: critic
---

## Why
The release (the car letting go of the inverted ledge and falling away) is the moment the whole Show
builds to, and on production it happens behind the HUD. Measured 2026-10-22 on production (81899cb),
the Show reference, the hero's projected centre (`carRoot` through `camera`) sampled every rendered
frame (docs/critique/2026-10-22-0400.md):

- **1440×900: the car's centre is above the bottom of the phase timeline (y 129 px) in 10 of 41 air
  frames (24 %)**, at y 66–91 px for the first ≈ 0.9 s after the release. `desk-4-release.jpg`: the car
  is drawn behind "03 HANG · 04 RELEASE", the top third of it cut by the frame edge, while the lower
  70 % of the frame is empty ground and sky.
- **390×844 portrait: 9 of 41 air frames (22 %)** under the mission block (bottom y 112 px), centre at
  y 62–85 px, i.e. behind the Retry button and the timeline dots. `phone-4-release.jpg` and
  `phone-C1-rolling.jpg` show the car half off the top edge.

Cause: the Show's carry camera aims at 55 % of the car's height (`src/render/director.js:155-159`,
`lookWant.y = carPos.y * 0.55 + 0.8`) from a camera capped at 10 m, so at the 27 m release the car sits
near the top edge until it has fallen about 10 m. The run-2 livestream kept the falling car mid-frame.

## What
- `src/render/director.js` (Show carry, and the Wall's "fall and roll" rig if it shows the same):
  aim so the car's projected centre stays inside a safe band below the top HUD (the mission block's
  bottom + a margin) and above the strip, e.g. look nearer the car's height early in the fall and ease
  toward the roofs as it descends, or raise the camera's cap. Keep the roofs of the row in frame over
  the row (the reason the low rig exists).
- No sim change. The replay rigs are out of scope unless they share the code.

## Acceptance criteria
- [ ] A probe (the critique's: project `__coldgas.carRoot` with `__coldgas.camera` each frame, compare
      with `[data-hud-box=mission]` and `.top-actions` rects) through the Show reference: the car's
      centre is below the mission block's bottom + 24 px in **100 %** of air frames at 1440×900,
      1280×720, 390×844 and 844×390.
- [ ] Over the row (car z between the row's ends) at least one parked roof is still in frame at
      1440×900 and 390×844 (screenshot in the PR).
- [ ] 0026's occlusion bar is not made worse: frames with the car's centre inside `.h-strip` at 390×844
      do not increase.
- [ ] Before/after screenshots of release + 0.5 s at 1440×900 and 390×844 in the PR.
- [ ] `flicker.mjs` regions unchanged or lower for show-* scenarios.

## Test plan
Add the in-frame probe as an e2e (phone and desktop projects) stepping the reference with
`liveStep` after `physicsReady()` (LESSONS: it is a function), reading the director's camera after each
step. Tag `@heavy` if it flies the whole reference under software GL.

## Out of scope
The strip covering the car on portrait phones (0026), the title and replay cameras.

## Critic re-measure (2026-10-22 22:00, production da53d64)
Still failing, and worse than the centre probe suggests. Measured on the Show reference with the
compact phone HUD #79 shipped (docs/critique/2026-10-22-2200.md):
- **Above the mission block's bottom + 24 px**: 12 of 41 air frames at 1440×900 (centre y 66–127, block
  bottom 115) and 12 of 41 at 390×844 (y 62–119, bottom 109), from release + 0.15 s to + 1.25 s. At
  1440×900, 10 of those frames have the centre *inside* the timeline's box.
- **844×390 (compact)**: the centre is in the top 15 % of the screen (y 29–55 of 390) in 12 of 41 air
  frames. The car is a dark upside-down sliver at the top edge, and the parked row is under the HUD
  line at the bottom (`phoneL-4-release.jpg`).
- **New, 390×844**: the car's projected bounding box (every visible mesh's box, through the camera) is
  **40–47 % covered** by the compact rail and the top bar in 15 of 41 air frames (release + 0.25 s to
  + 1.35 s, box x 52–255, y 4–178). The centre sits just right of the rail (x 136), so 0061's
  centre-only probe passes, but the car's tail is drawn under the rail (`phone-4-release.jpg`).

Added criterion: at 390×844 and 844×390, no air frame has more than 10 % of the car's projected
bounding box under any `[data-hud-box]`, `[data-hud-toggle]` or `.top-actions` rect.

## Critic re-measure (2026-10-27 15:37, production 7866072): the iPads too
The same carry camera on an iPad. 820×1180 touch (rotated to 1180×820 at release + 0.25 s, the reference
run): the car's projected centre is in the top 15 % for **18 of 51** sampled air frames (minimum y 0.071).
1180×820 touch (valves shut at release + 0.125 s): **11 of 48** (minimum 0.079). `ipadP-4a-prerotate.jpg`: the
car, upside down, fills the top 13 % behind the `T +00:10.5 · 04 RELEASE` stack; `ipadP-4-release-rot.jpg`,
0.4 s after the rotation, it is a ghost at the top edge over an empty pad and rocket. Add 820×1180 and
1180×820 to the probe's viewports.

## Shipped (#129)
`keepClear` in src/render/director.js turns the live Wall/Show camera just enough to hold the car's centre
below the top HUD (and right of the upright phone's rail); the Show carry rig stands back and rises with the
car while it is high, so the roofs stay in frame. `tests/e2e/release-frame.spec.js` flies the reference at
1440×900, 1280×720, 390×844, 844×390 and the iPads (820×1180, 1180×820): 0 air frames above the HUD + 24 px,
none in the top 15 % (main: 0.079 on both iPads), a roof in frame over the whole row. Still blocked on the flicker
gate: the tilt shows more of the lit curl, and `show-live-jets/wall` reads 226 ‰ desktop / 205 ‰ phone (main
130 / 115, limits 161 / 144) on software GL, after main's #131. Attribution in the PR (#129) and LESSONS.

Known limit: the safe line is a quarter of the way down the frame, not the HUD's measured bottom, so a desktop
window under ≈ 556 px tall (mission block bottom 115 px + 24) can still put the car's centre under the block.
