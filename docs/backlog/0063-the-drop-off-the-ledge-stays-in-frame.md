---
id: 0063
title: The drop off the ledge stays in frame, clear of the top bar and the timeline
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-22
pr: 127
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
- [x] A probe (the critique's: project `__coldgas.carRoot` with `__coldgas.camera` each frame, compare
      with `[data-hud-box=mission]` and `.top-actions` rects) through the Show reference: the car's
      centre is below the mission block's bottom + 24 px in **100 %** of air frames at 1440×900,
      1280×720, 390×844 and 844×390.
- [x] Over the row (car z between the row's ends) at least one parked roof is still in frame at
      1440×900 and 390×844 (screenshot in the PR).
- [x] 0026's occlusion bar is not made worse: frames with the car's centre inside `.h-strip` at 390×844
      do not increase.
- [x] Before/after screenshots of release + 0.5 s at 1440×900 and 390×844 in the PR.
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

## Shipped (#127)
The Show's carry frames the car and the roofs under it (src/render/director.js `carry()`). Probe
`tests/e2e/ledge-frame.spec.js`, every air tick at 60 fps (245 frames): car centre above the band
72/85/73/64 → 0 at 1440×900 / 1280×720 / 390×844 / 844×390; box > 10 % under the HUD 79/88/99/0 → 0.
At least one roof in frame over the row in every frame; strip frames at 390×844 0 → 0; Wall fall unchanged
(already 0). **Flicker criterion not met**: show-live-jets/wall 130 → 259 ‰ (desktop) and 119 → 193 ‰
(phone) on SwiftShader, because the lit curl is now in frame while the camera follows the fall. Every
other region is at or under main. Merge is the operator's call (see the PR).
