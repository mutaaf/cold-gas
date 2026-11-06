---
id: 0171
title: "The iPhone app catches up with the web: this physics, the carry's re-cuts, and How to play says what the board really does"
status: in-progress
priority: P1
size: S
lens: platform
created: 2026-11-06
by: operator
---

## Why
The web's physics moved past the build in review, the carry's camera changed (0118), and How to play said the server re-flies a posted run. It scores the run's telemetry instead.

## What
Runs on: the operator's Mac (Xcode). iPhone app only.
- `Director.swift`: 0118's re-cuts and front-body truck, from director.js.
- `HowToView.swift`: the board's check in true words.
- `ios/store/review-reply.md`: the correction owed to App Review if they reject or ask again. Nothing is sent or changed on the submission in review.

## Acceptance criteria
- [x] Swift core tests pass at the web's SIM_VERSION.
- [x] Touch tests pass on the Pro Max and closed Duo simulators.
- [ ] A TestFlight build for the owner to fly. Not attached to the version in review.

## Test plan
`make test`, then `ios/ColdGasUITests/FlightUITests.swift` on both simulators; the carry's cuts by eye with `-cam-log` on the Show.
