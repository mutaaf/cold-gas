---
id: 0158
title: "The iPhone app's camera is the web's director: the rigs, the hard cuts, the lens rules, the crash cut"
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
The app's camera was a first cut: one side tracking rig with a 60° horizontal lens. Upright on a phone that's a vertical
lens of about 100°, so the car was tiny in flight. On the Lineup the rig stood on the line of lamp poles, which swept
across the screen as a thick black bar.

## What
Runs on: the operator's Mac (Xcode, Metal).
- `ios/ColdGas/Render/Director.swift`: src/render/director.js's live rigs, same numbers and order. The Lineup's chase and
  broadcast. The Wall's chase, side cam, inverted wide, fall and landing cam. The Show's HOLD, CARRY and FOLLOW, entered by
  hard cuts (0063, 0113, 0116, 0128), and the landed rig with `lens()`, LAND_SIDE and LAND_LIFT (0108, 0119). `keepClear`'s
  pitch, shake, the touchdown's dip and punch-in, and the crash cut.
- `CameraFraming`: what the web measures in the DOM, from the layout: the HUD's foot and each touch control's box in the
  scene's coordinates (`ThumbPad.size`, `ClassicPad`). Tabletop's controller has its own panel, so it has no pads.
- `Crash.cut` hands the run's first big hit to the director, which places the camera. The slow motion stays in Crash.swift.
- `Game` sends the touchdown once per run, keyed on the touch tick as main.js does.
- `-cam-log` prints the camera's state and its cuts. In Debug, `-timescale ground,air` slows the app's clock for timed
  screenshots, `-cam-cut-tick` fires the crash cut and `-script-end` lets go of a recorded run at a tick.

On purpose unlike the web:
- Every Lineup rig keeps 2.5 m off the poles' line. The web's broadcast stands 14 m out, about 1 m past the poles at x = ±13.
- Upright, the Lineup's broadcast and landed shots take 0108's horizontal lens, and the broadcast aims at the car. The
  web's cuts the car at the screen's edge at 440×956.
- No left rail in the app, so no yaw off it. Upright once launched, the car's box stays inside the screen's sides instead.

Left out:
- The replay theatre's cuts, Free Drive and the pilot view. A phone player on the web sees the pilot view only after
  choosing it, or in Practice, and the app has neither.
- The title's cameras. The web's frame a parked car; the app's title loops the reference run behind the panel, so it flies
  on the live rigs.

## Acceptance criteria
- [x] Show, Wall and Lineup at 440×956: the car is readable at every phase, nothing opaque crosses the lens, the hard cuts land
  where the web's do, and the pad doesn't hide the car (contact sheets compared with the web's at the same moments).
- [x] The Show in the Duo's poses (`-window` on the simulator): 951×669, 669×455 and 466×678 frame the car from the scene's own
  aspect, and the upright outer screen hands over to the follow before the pad (0128).
- [x] The crash cut's placement and hard cut back, fired on demand (`-cam-cut-tick`).
- [ ] The crash cut from a real hit over 6.5 m/s. None of our recorded crashes reaches one (the hardest is 5.3 m/s).
- [ ] On a phone at 120 Hz, and on Duo hardware. Nobody has watched this outside the simulator.

## Test plan
`make rules` in `ios/`; `swift test --no-parallel` if the package changed. Fly each course at 440×956 and each Duo pose with
`-timescale 1,0.03 -cam-log`, and put the frames beside the web's at the same moments. On the phone, one flight of each
course by hand.
