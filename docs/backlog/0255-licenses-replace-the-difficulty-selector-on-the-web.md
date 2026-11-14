---
id: 0255
title: On the web, licenses replace the Assist/Pro/Advanced selector as the way forward, and free play keeps every tier open
status: proposed
priority: P1
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Phase 2 brief: licenses replace the difficulty selector, unlocked by demonstrated skill, with progress kept, mastery
visible and the next goal always clear; free play stays. Today a newcomer meets the tier as a setting (the Assist control on
the title and the results, the top-bar chip, the picker; `coldgas_tier`), with rookie.js and adapt.js nudging between them.
A tier choice says nothing about what to do next.

## What
Depends on: 0254 (the store and the rules), 0248 (the first jump is Rookie's first test), 0245 (`license_pass`).
- **The title leads with the next goal**: the primary action is the next license test ("Bronze · land a 360 · Jump"),
  which sets its own course and tier; "Free play" beside it is today's course switch + Jump with the tier picker.
- **A licenses screen** (from the title and the results): the six licenses, each test with its best and a tick, the next one
  marked. Passing a test or a license shows on the results ("Bronze passed") and in the landing beat, once.
- **Nothing is locked** (no dark patterns; tiers are a control scheme, not a reward): Free play keeps Assist, Pro and Advanced
  open to everyone, as today; licenses recommend the tier, they don't gate it. The tier picker leaves the title's main
  column and lives in Free play and the pause sheet. rookie.js's offer and adapt.js's step down/up keep working in Free play
  and become "try the Bronze test" suggestions on the license path.
- Medals stay (they are per course and tier); the licenses screen shows them under each course's tests.
- Copy is our own (§3.7); "Ace" not "Pro" for the fifth license (0254).
- `license_pass` events (0245).

## Acceptance criteria
- [ ] e2e: a fresh player's title shows Rookie's test as the primary action; passing it shows "Rookie passed" once and the
      next goal becomes Bronze's first test.
- [ ] e2e: Free play still offers all three tiers to a new player; a returning player with medals sees the licenses their
      medals already prove (0254's migration).
- [ ] No run's log, card or board entry changes with licenses on or off.
- [ ] `npm run audit` passes; works at 390×844 touch and 1280×720 keyboard (every license test reachable by keyboard).

## Test plan
`tests/e2e/licenses.spec.js`; the title audit with the new title; unit coverage stays in 0254.

## Out of scope
Wreck Club ranks and cosmetics (0242, which reads the same store). The iPhone (0256).
