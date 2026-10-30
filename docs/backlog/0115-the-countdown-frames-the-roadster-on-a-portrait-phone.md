---
id: 0115
title: The run-up frames the whole roadster on a portrait phone
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-10-29
pr:
by: scout
---

## Why
In the scout's 390x844 capture of `?play=jump` at T−1.1 s (RUN-UP, `main` `09b6c3f`, SwiftShader), the roadster
sits against the right edge with its nose cut off by the screen and the lineup beyond it out of view, while the
telemetry rail takes the top left and the one-thumb pad the lower right. The first look at the car on a phone should
show it whole; the desktop frame (1280x720) shows the car and the row. Verify on the real run-up first: if the car
is whole at the moment control is handed over, this ticket is a no-op and gets dropped.

## What
- `src/render/director.js`: for portrait aspect ratios, widen the run-up/countdown rig's field or pull it back so the
  car's bounding box (projected) is inside the safe area, using the same keepClear measure as the live rigs.
- No sim change; the Show's release hold and the carry are untouched.

## Acceptance criteria
- [ ] At 390x844, 430x932 and 360x780 the projected roadster box is fully inside the viewport and clear of the HUD
      rects at T−1 s and at control hand-over.
- [ ] `flicker.mjs --only=` the run-up scenarios does not rise over the budget.
- [ ] hud-audit and title-audit stay clean.

## Test plan
An e2e that projects `carRoot` through the camera at countdown end per viewport and asserts the box is inside it
(the 0068/0108 pattern).

## Out of scope
The touchdown framing (0108), the row through the carry (0113), the foldables (0107).
