---
id: 0202
title: On a phone, the results sheet's backdrop shows the car that just landed, not an empty ramp
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-11-12
pr:
by: critic
---

## Why
The focus's item 1 is "the score right after landing". On a phone, once the landing beat (0199) hands over to the
sheet, the top half of the screen (0–474 px, above the verdict) shows the empty curl and its truss. The car isn't in
it.

Measured on production `index-DxnlFBnX.js` at 390×844 touch, first visit, reference run, results 0.5 / 2 / 5 / 10 s.
The car's projected 2 × 1.2 × 4.4 m box (look-audit's projection):

| sheet time | car (x, y, z) | car box on screen (px) | verdict top |
|---|---|---|---|
| 0.5 s | 0, 0.4, −2 | y 743–793 | 474 |
| 2 s | 0, 0.6, 2.2 | y 720–784 | 474 |
| 5 s | 0, 1.9, 6 | y 676–758 | 474 |
| 10 s | 0, 4.4, 9.3 | y 614–706 | 474 |

- The sheet's backdrop replays the run from the start, inside a fixed wide shot (camera at x 43.4, y 11.9, z −12.6).
- For at least the first 10 s the car is under the sheet's text, and the visible half is an empty ramp
  (`docs/critique/2026-11-12-0407/sheet-show-10.png`, `S-follow-results.png`, `W-follow-results.png`).
- The Lineup's backdrop is a dim grey blur of a parked vehicle (`L-held-results.png`).
- The player has just landed a car on four jets, and the screen that carries the score doesn't show it.

## What
Frame the sheet's backdrop so the car is in the visible part of the scene above the sheet. Either:
- hold on the car where it came to rest (on the pad, in the clearing plume, as the beat does in `S-follow-beat.png`), or
- if the backdrop loop stays, frame it with the car in the top band, reusing the director's phone framing that keeps
  the car above a bottom panel (`src/render/director.js`, `src/main.js` results mode).

The same on the Show, the Wall and the Lineup.

## Acceptance criteria
- [ ] 390×844 and 430×932 touch, Show / Wall / Lineup, at sheet times 0.5, 2, 5 and 10 s: the car's projected box is
      on screen and its centre is ≥ 40 px above `[data-r-verdict]`'s top (today, under it at every time).
- [ ] The car box's P10 luma is ≤ 60 at those moments, as 0187's bar (the car reads, not a silhouette in fog).
- [ ] 1280×720 and 1440×900: the car's box doesn't overlap the sheet panel (both sizes, both orientations at 844×390).
- [ ] `npm run audit` clean. No new flicker past budget on `show-replay` (the backdrop's frames).
- [ ] Funnel number to move: `retry` / `run-landed` (a sheet that shows what you did invites the next run).

## Test plan
Add a `sheet` moment set to `scripts/look-audit.mjs` (projected box vs the verdict's rect) and an e2e assertion in
`tests/e2e/first-landing.spec.js` that the car's projected centre is above the verdict at 0.5 s and 5 s.

## Out of scope
- The beat (0199) itself.
- The replay opened from the Replay button (0068).
