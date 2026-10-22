---
id: 0061
title: On a phone the HUD collapses to one slim line off the road; one tap brings everything back
status: shipped
priority: P0
size: M
lens: player-feel
created: 2026-10-21
pr: 79
by: operator
---

## Why
The operator, verbatim: "on mobile the stats and analytics cover the whole drivable viewing of the
screen we need to collapse those".

Measured on lockdown/base (2026-10-21), every frame of the Show's reference flight and 4 s of
Free Drive on Stelvio, HUD boxes (`[data-hud-box]`, Free Drive's `.fd-*` and the handle) rasterised
on a 4 px grid, the car's centre projected through the camera:

| | 390×844 | 844×390 | 820×1180 | 1280×720 |
|---|---|---|---|---|
| Show: share of the screen under the HUD (max) | 24.7 % | 21.5 % | 14.6 % | 15.0 % |
| Show: frames with the car's centre under the HUD | 350 / 925 (strip 304, mission 46) | 20 / 937 | 33 / 936 | 48 / 953 |
| Free Drive: share of the screen (max) | 19.0 % | 22.2 % | 7.4 % | 13.0 % |

The car's own path on screen (same probe): upright it stays right of 37 % of the width at every
height and flies to the top edge in the air (y 69–503 of 844); sideways it keeps to the top 62 %
(and right of 47 %). Free Drive's chase camera holds it at 58–68 % of the height, centred.

This absorbs 0026 (the strip over the car in portrait), which it replaces.

## What
- `src/hud-mode.js` (new): `compact` | `full` on `:root[data-hud]`, default compact on a touch screen
  whose short side is ≤ 900 px (phones, 11" tablets), full elsewhere; kept in localStorage
  (`coldgas_hud`, try/catch); one delegated listener for every handle; `I` toggles from the keyboard.
- The Show, the Wall, the Lineup and drills (`index.html`, `src/styles.css`): compact upright is a
  rail on the left edge (phase and clock, SPD · ALT · G · N₂ on the ground, SINK · G · N₂ in the air,
  the handle; in the air the descent's tape and state under it); sideways a line along the bottom
  between the stick and the right thumb, the phase and clock above it. The attitude dial, the
  vehicle panel, the big speed, PITCH, FAN and the second unit system fold away. Full is today's
  layout with the handle closing the mission row (upright) or as a tab on the strip's top edge
  (sideways).
- Free Drive (all roads and endless) and the Sandbox (`src/drive/hud.js`, `src/build/sandbox.js`,
  `src/drive/drive.css`): compact is one line under the road's name (speed · elevation · grade, or
  height · gas) ending in the handle; the map, the camera/time/fan chips, the subtitle and (on a road)
  the build dock fold away; Reset, Exit, the timer and the map credit stay.
- Always up: the cue line, the descent's band, state and BRAKE line, the touchdown ring. Colour still
  means state only (the compact SINK wears the descent's amber/red; N₂ shows BLOWDOWN in amber).
- No sim change.

## Acceptance criteria
- [x] Compact, every frame of the Show's reference flight at 390×844, 844×390 and 820×1180 (touch):
      the HUD covers **≤ 12 %** of the screen and the car's projected centre is under a HUD element in
      **0 frames** (`tests/e2e/hud-collapse.spec.js`).
- [x] Compact, Free Drive (Stelvio, throttle held) at the same three sizes: **≤ 12 %**, **0 frames**.
- [x] A phone (coarse pointer) starts compact; one tap on the handle (a button, ≥ 44×44 px, in both
      states) shows every instrument and another folds them; the choice survives a reload; Enter on the
      focused handle and `I` toggle it; a tap leaves no focus behind.
- [x] A desktop starts full with today's layout (no handle); `I` folds it and the handle unfolds it.
- [x] Compact, a landing drill on a phone: the descent's tape, its state and the BRAKE line are
      visible, and the touchdown ring is up.
- [x] `node scripts/hud-audit.mjs` (flies every viewport compact and full) and
      `node scripts/title-audit.mjs`: 0 overlaps, 0 text < 11 px, 0 labels < 4.5:1.
- [x] Screenshots at 390×844, 844×390, 820×1180 (touch) and 1280×720, compact and full, in the Show
      and in Free Drive, checked by eye.

## Test plan
`tests/e2e/hud-collapse.spec.js` (toggle, keyboard, persistence, landing cues, the coverage probe on
both modes of play at three sizes); `tests/unit/hud-mode.test.js` (the default by device);
`tests/e2e/hud.spec.js` pins the full set on a phone; `tests/e2e/endless.spec.js` opens the map with MORE.

## Out of scope
The top bar, the touch controls and the cue line's wording; the camera's framing.
