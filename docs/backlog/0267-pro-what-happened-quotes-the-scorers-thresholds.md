---
id: 0267
title: On Pro, What happened's clean fix quotes the scorer's thresholds and agrees with NEXT RUN
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-11-16
pr:
by: builder
---

## Why
0261 made NEXT RUN's clean line (src/pointer.js) name what the card still pays for, with the scorer's own thresholds.
What happened's clean fix (src/sim/coach.js `finish`) on Pro and Advanced still says "Chase the details: sink under
1 m/s, the 2 m ring, more gas left": the scorer pays full sink marks at 0.9 m/s (judge.js `LANDING.sink`) and the
Show's and the Wall's mark inside 3.5 m (`SHOW_PRECISION`). On a strong Pro card (judges capped at 10 by ×1.08) NEXT RUN
now says "try Advanced" while What happened says to chase the details: the same sheet disagreeing with itself that 0261
fixed on Assist. Found in 0261's self-review; deferred because coach.js is ported line for line to the iPhone app.

## What
`src/sim/coach.js` `finish`: the non-Assist clean fix quotes `LANDING.sink[1]` and the course's full-marks ring from
`src/sim/judge.js` exports (or, with a card, agrees with src/pointer.js `cleanTarget`), and the same change in
`ios/Packages/ColdGasCore/Sources/ColdGasPhysics/Coach.swift`, with `npm run vectors` (Tests/Vectors/coach.json carries
the string).

## Acceptance criteria
- [ ] Pro and Advanced: What happened's clean fix quotes 0.9 m/s and the course's full-marks ring (unit test against
      the judge.js exports).
- [ ] On a Pro card with no headroom, NEXT RUN and What happened give the same next step.
- [ ] `npm run vectors -- --check` passes; the Swift coach matches.
- [ ] Works at 390x844 touch and 1280x720 keyboard.

## Test plan
tests/unit/pointer-clean.test.js beside 0261's cases; the vectors check.
