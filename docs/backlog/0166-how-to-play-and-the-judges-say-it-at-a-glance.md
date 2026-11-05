---
id: 0166
title: "How to play and the judges say it at a glance: aurora fields for what matters, the rest folded"
status: in-progress
priority: P1
size: S
lens: platform
created: 2026-11-05
pr: 261
by: operator
---

## Why
The owner: how to play and the judges' reviews are too much text. Use bright aurora fields to show the important things, and use the space well, with accordions.

## What
Runs on: the operator's Mac (Xcode). iPhone app only; the web's screens are unchanged.
- `ios/ColdGas/UI/Aurora.swift`: the web's aurora colours as a moving field with near-black ink, still under Reduce Motion; an accordion; a term-and-meaning row.
- How to play: Hold, Tap, Hold in three aurora tiles, what scores, then the rest in single-open accordions.
- Results: the score in an aurora field. Three judge tiles; a tap shows that judge's call, otherwise the headline. The numbers fold away and scroll into view when opened.
- Under 720 pt tall the actions take one row; under 470 pt the score shrinks too.
- A crash, a wreck or no jump gets no aurora, as on the web. Whose words these are stays on screen (invariant 5½). The coach's "Clean" shows only on a run that earned the aurora.

## Acceptance criteria
- [x] Six touch tests pass on the Pro Max and closed Duo simulators, including one-open-at-a-time and the opened numbers being on screen.
- [x] Seen: a landing, a stall and a no-jump collision on the Pro Max simulator; a landing on the closed Duo's outer screen and on the `-pose tabletop` layout.
- [ ] The Duo's real inner screen: the simulator boots closed and can't be unfolded from a script, so it hasn't been run.
- [ ] The same on a real iPhone, with the frame rate checked on the results sheet with the field moving.

## Test plan
`ios/ColdGasUITests/FlightUITests.swift` on both simulators: `testHowToFolds` (first screen, closed text hidden, one open at a time) and `testOneThumbFlightByTouch` (a judge tile, and the opened numbers on screen). Crash and stall states by eye, flown with `-script <vector> -script-end <tick>`.
