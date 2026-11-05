---
id: 0160
title: "The coach and the drills in Swift, word for word, so the iPhone's results can name what cost the points"
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
The iPhone's results give a score and no reason. On the web the coach names what cost the points and what to do next,
in the words of the controls in the player's hand. 0156 left it out of 1.0, with the drills. A coach that drifts from
the web's would tell a phone player something different about the same flight.

## What
Runs on: the operator's Mac; the app wires it into the results separately. No game behaviour changes in `src/`.
- `ColdGasPhysics/Coach.swift`: src/sim/coach.js and aim-words.js, and pointer.js's `coachWords`; main.js's `pointerCtx`
  (one thumb only on touch, off the Lineup, on Assist). The context is ColdGasClient's `Daily.Pilot`.
- `ColdGasPhysics/Drills.swift`: src/practice.js, and the part of autopilot.js the drills fly (`wallPilot`). A drill
  reaches its hand-over through `stepRun` alone, so the sim needs nothing new.
- `LiveRun(drill:)`: a live run from a hand-over, the carry drill's moment (`drillMoment`, `endDrillMoment`), the drill's
  own card (`drillSnap`) and `coachResult(say:)`, what main.js's finishRun shows.
- `simulateReading`: simulate with the tick's input, which the coach reads. `simulate` calls it.
- `Tests/Vectors/coach.json` (scripts/vectors-lib.mjs coachVectors), and five `drill-*` input vectors flown on the page's
  controls from a hand-over.

## Acceptance criteria
- [x] Over all 52 run vectors and every input vector, on one thumb and on classic touch: the same items in the same order, the weights by bit pattern, the words exact.
- [x] The flight the coach read, field by field, and what the mark and the sink cost, by bit pattern.
- [x] Every drill on every course hands over on the JS's bits, with the same log; flown on, the same telemetry, card, drill result, own coaching, aftermath and coach.
- [x] LiveRun flown from a hand-over by scripted touches matches the JS's page controls.
- [ ] Wired into the iPhone's results (the app, separately).

## Test plan
`npm run vectors`, `npx vitest run tests/unit/vectors.test.js`, `cd ios/Packages/ColdGasCore && swift test --no-parallel`.

## Not in this
`pickPointer`, `pointerText` and `betterText` (the one-line pointer and "Better: …"), `howtoRows`, `livePointer`; the
Lineup's reference pilot and Advanced's `byHand` (no drill flies them). No vector reaches the coach's `fell-off` or
`flipped` findings: their strings were compared with coach.js's by script, not flown.
