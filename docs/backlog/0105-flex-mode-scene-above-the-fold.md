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
- A small pure module (`src/fold.js`): the segments and the posture from `window.viewport.segments` and the
  media queries, as one state `{ split: 'none'|'rows'|'cols', fold: {…} }`, with a change callback.
- Rows (a horizontal fold): the scene is drawn for the top segment (the camera's view offset), the HUD's
  band, the cue, the touch controls and the sheets sit in the bottom segment, the top bar in the top one.
- Columns (a vertical fold): the centred sheets (pause, results, board, controls) sit in one segment.
- `tests/e2e/flex.spec.js`: the DevTools protocol's display feature and posture override.

## Acceptance criteria
- [ ] A horizontal fold at 360×748 and 744×780: no HUD box, control or sheet button crosses the fold's band; the car's projected centre is in the top segment through a run.
- [ ] A vertical fold at 951×589 and 744×780: the pause sheet, the results and the board sit in one segment.
- [ ] Unfolding back to one segment restores the layout in the same run (no reload, same run).
- [ ] Without segments nothing changes (the queries are false; the audit unchanged).
- [ ] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
`tests/e2e/flex.spec.js`; `tests/unit/fold.test.js` for the pure state.

## Out of scope
A tent pose. Safari (no APIs, 0102).
