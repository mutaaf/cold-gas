---
id: 0128
title: On one thumb the car crosses the row in sight, not under the held pad
status: ready
priority: P0
size: M
lens: player-feel
created: 2026-11-01
pr:
by: critic
---

## Why
The carry over the row is the one frame the Show exists for, and on an upright phone with one thumb the player
can't see it. The car flies under the pad their thumb is holding. One-thumb is what a first visit on a phone gets
(`[data-touch]` `data-scheme="thumb"`). Measured on production `e00d23b` (docs/critique/2026-11-01-1600.md):

- **The run:** a first visit at 390×844 touch, DPR 2, `?gfx=low`. Real CDP touches on `[data-onethumb]`: hold, tap on
  *Let go*, hold to the ground, no slide. It scored 84.7 Stuck it.
- **How it was measured:** from the first air tick the page is stepped at 30 fps. `liveStep` and `director.update` run
  together, the way `tests/e2e/frame-probe.js` does it. For each frame, the hero's 8-corner box is projected through
  `__coldgas.camera` and sampled on a 21×11 grid against the pad's circle (centre 278, 692; r 66 CSS px).
- **Car under the pad, by share of its box:**
  - **≥ 50 %** in **29** of the carry's 82 frames (≈ 1.0 s), from z −17.1 to −22.4.
  - **≥ 99 %** in **14** frames (≈ 0.5 s), from z −20.2 to −22.4. That's the car over the back of the row and into
    the brake, 5.7 → 4.7 m up.
  - Then the director cuts to `follow` and the car is 196 px wide, clear of the pad.
- **What a held pad looks like:** it's `rgba(245, 246, 248, 0.9)` (`src/styles.css:1168`), so the car behind it is
  gone. Without a hold it's a faint ghost (`2026-11-01-1600/first-5-over-row.jpg`). On a phone there's also a thumb
  on top of it.
- **Why the camera puts it there:** the carry's band (`measureBand`, `src/render/director.js:156–171`) counts the top
  HUD and anything docked across the *middle* of the bottom. The pad sits bottom-right (`right > 85 %` isn't
  counted), so `fitCarry` steers the car toward the pad.
- **Why no gate catches it:**
  - `hud-cover.mjs` measures the air at the release frame only (z < −9), where the car is still clear.
  - Every framing probe (`frame-probe.js`, `release-frame.spec.js`) flies the reference with autopilot, and with
    autopilot the pad is hidden (`thumbActive()`, `src/main.js:989`).

The real carry was filmed side-on, with the car clear of everything in frame over the Semi (REVEAL_RESEARCH §2.2).
A frame where the hero is hidden behind the controller for half a second over the row would be called out on stage.

## What
- `src/render/director.js`: treat the touch controls the player is using as part of the band. That's the one-thumb
  pad (and classic's right cluster) when shown, as a rectangle the car must stay out of. Either keep the car's box
  out of it in `fitCarry`, or bias the carry so the car crosses in the free column above or left of it. On an
  upright phone 0116's across-the-row stand-back stays; this only moves where the car sits in it.
- Keep 0113/0116's bars: the row's roofs in frame, the car under the top line, no fast re-place (flicker).
- Close the gate's blind spot: a one-thumb, non-autopilot flight through the whole carry. Extend `frame-probe.js`'s
  `fly()` with a `thumb` option that holds `__coldgas.thumb` instead of the autopilot. Then assert the car's share
  under the touch controls in `release-frame.spec.js`.
- No sim change.

## Acceptance criteria
- [ ] At 390×844 touch, one-thumb, held from the tap to the ground, stepped at 30 fps from the release until the car is
      1 m up: the car's box is **≤ 10 %** under the pad's circle in every frame, and **0** frames are ≥ 25 %.
      Today it's 29 frames ≥ 50 % and 14 frames ≥ 99 %.
- [ ] The same at 360×780 and 430×932 touch (small and large upright phones), and with `hand=left`.
- [ ] 0116/0113 still hold: `rowShown` and the row-roof assertions in `release-frame.spec.js` stay green on upright
      screens. Car width over the carry at 390×844 is not smaller than today's ≈ 69 CSS px.
- [ ] `flicker.mjs --only=show-live-jets --phone` not raised past `docs/flicker-budget.json`.
- [ ] Real frames at car z ≈ −17 and −21, 390×844 one-thumb with the pad held, before and after, in the PR.
- [ ] 1280×720 keyboard and 844×390 landscape framing unchanged (no touch pad in the band there, or measured equal).

## Test plan
`frame-probe.js` gains the one-thumb flight and a `padCover` series. `release-frame.spec.js` asserts the bars above at
390×844, 360×780 and 430×932. `hud-cover.mjs --gate` samples the carry, not just the release frame.

## Out of scope
The car's size through the carry on landscape and desktop (0118). The pad's own look while held (0126). The
`follow` and touchdown rigs.
