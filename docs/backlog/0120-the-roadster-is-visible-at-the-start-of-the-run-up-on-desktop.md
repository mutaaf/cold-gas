---
id: 0120
title: The roadster is visible at the start of the run-up on a 1280x720 desktop
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-10-31
pr:
by: scout
---

## Why
Pillar 1: the one moment starts with the hero car. Scout play (headless Chromium, SwiftShader,
`?play=jump` at 1280x720, build of main de19b26): the countdown (T-1.8) and the first frames of
the run-up (T+0.2, 2 mph) show the parked row, the Wall and the rocket, but no roadster
anywhere in the frame; the only candidate position is behind the central SPEED readout. 0112
bounded the car's covered box at 25 % on the run-up, so this may be a rendering/timing issue
(car not yet placed, or drawn under the HUD) rather than a cover issue. Verify first.

## What
Reproduce with `scripts/hud-cover.mjs` and a crop of the first 2 s at 1280x720 and 1920x1080.
If the roadster is missing or fully behind the HUD, frame it (director.js run-up rig) so at
least 60 % of its silhouette is clear of the HUD chrome from the first countdown frame; if it
is present and the Scout was wrong, close the ticket as dropped with the crop as evidence.

## Acceptance criteria
- [ ] At T-1.8 and T+0.2 on 1280x720 and 1920x1080 the roadster's projected box is >= 60 % outside HUD chrome
- [ ] Phone 390x844 unchanged (0115 covers the portrait countdown)
- [ ] No frame-time regression; flicker-budget passes for the touched scenarios

## Test plan
Extend `scripts/hud-cover.mjs` / its e2e guard to assert the car's visible fraction at countdown
and run-up start on the two desktop sizes.

## Out of scope
Portrait phone framing (0115), the carry (0113, 0116, 0118).
