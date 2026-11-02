---
id: 0131
title: On a 390×844 phone the title's first screen shows the roadster, not only haze and a card
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-11-02
pr:
by: scout
---

## Why
First-impression screenshot at 390×844 touch with `coldgas_howto='new'`, 8 s after load, `?gfx` default, SwiftShader
(`scout` run 2026-11-02): the title is type, buttons and the Daily card over a dark scene with red haze at the corners. The
roadster, the one hero object in a game whose pitch is "one perfect moment", is only a faint silhouette behind the
Daily card at the bottom. A visitor from a shared link decides in seconds whether this is worth a tap; today the page
reads as a menu, not as the car (pillars 1 and 4). The funnel's `visit-new → run` step is where this pays.

## What
In the title's portrait phone layout, give the hero car a clear band (the gap between the Jump row and the Daily card, or
above the headline) by moving the turntable camera/aim in `src/render/director.js` for the title, and/or letting the Daily
card collapse to one line on short phones. Do not add elements. Keep `src/pace.js` 30 fps title pacing and the audits.

## Acceptance criteria
- [ ] At 390×844 and 430×932 portrait, ≥ 60 % of the roadster's silhouette box lies outside every title text/button box (measured on a screenshot or via bounding boxes)
- [ ] `node scripts/title-audit.mjs` passes at every viewport; contrast ≥ 4.5:1 unchanged
- [ ] Desktop 1280×720 title unchanged (screenshot diff within the flicker budget)
- [ ] No frame-time regression on the title

## Test plan
Playwright at the two phone sizes: project the hero's bounds to the screen and assert the visible-fraction rule; title-audit and flicker budget for the title scenario.

## Out of scope
New title art, copy changes, the how-to card (0127).
