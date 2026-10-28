---
id: 0105
title: Flex Mode and a reported hinge - the scene above the fold, the controls below, no sheet on the crease
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-27
pr:
by: operator
---

## Why
Half-folded on a table (a flip's Flex Mode, a book fold held like a laptop), Chromium reports the fold as
two stacked viewport segments (`vertical-viewport-segments: 2`) and the posture as folded (0102). Today
only the cue line moves below a horizontal fold; the car, the band, the touch controls, the pause sheet and
the results can sit on the crease, and the scene is framed for the whole screen though only the top half
faces the player. A vertical hinge (a book fold half-open) keeps the band off it (0075), but the pause
sheet, the results and the board centre on it. Safari reports neither (measured, 0102): all of this is
progressive enhancement, inert there.

## What
- `src/fold.js` (pure): `foldState({ segments, folded })` → `{ split: 'none'|'rows'|'cols', fold, folded }`;
  `readFold(win)` reads `window.viewport.segments` and `(device-posture: folded)` (the media query: headless
  Chromium 156 has no `navigator.devicePosture`).
- `src/main.js` `syncFold`: `:root[data-fold]` and the hinge's edges as `--fold-a` / `--fold-b` (px), on every
  resize and when the segment or posture queries change (a posture change need not resize the window); the
  camera and the drawing buffer re-fit (stage.reshape), the HUD density refits.
- `src/styles.css`, rows (a horizontal fold): the canvas stops at the fold, so the scene (and the camera's
  aspect) is the top segment; the descent and the cue line stand just under the fold; the touch controls
  were already low; the title starts under the fold and scrolls there if it must; the pause sheet, the board
  and the results stand in the bottom segment. `src/hud-mode.js`: no room for the full set in rows.
- Columns (a vertical fold): the pause sheet and the board in the left segment, the results in the right,
  the judges' theatre (where it takes the screen) in the left. (0075 already kept the band, the phase tab
  and the cue line off it.)

## Acceptance criteria
- [x] A horizontal fold at 360×748: no control, HUD box or text crosses the hinge's band on the title, in the run (in the air too), or on the pause sheet; the car's projected centre stays in the top segment through the air (e2e). 744×780 rows and 951×589 columns checked the same way with a probe (no e2e: CI time).
- [x] A vertical fold at 744×780: the title, the run, the pause sheet, the theatre and the results keep off it (e2e).
- [x] Opening flat restores the layout in the same run (same `S.run`, no reload; the canvas and the camera take the whole screen again).
- [x] Without segments nothing changes (no `data-fold`; the audits and every other e2e unchanged).
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
`tests/unit/fold.test.js` (the pure state); `tests/e2e/segments.spec.js` (rows at 360×748 and columns at 744×780
over the DevTools protocol: `setDeviceMetricsOverride.displayFeature` and `setDevicePostureOverride`;
`setDisplayFeaturesForTesting` doesn't exist and `setDisplayFeaturesOverride` isn't in Chromium 156). Shots
in docs/shots/0105/ (taken with CDP's own capture: Playwright's screenshot resets the emulated fold).

## Out of scope
A tent pose. Safari (no APIs, 0102).
