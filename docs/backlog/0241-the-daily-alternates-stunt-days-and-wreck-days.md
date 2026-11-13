---
id: 0241
title: The Daily alternates stunt days and wreck days
status: ready
priority: P2
size: S
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13). A reason to come back that also teaches the second score: one day asks for a clean
stunt, the next for a spectacular wreck.

## What
Depends on: 0237, 0238.
- src/daily.js: alternate UTC days are wreck days, with objectives judged from 0237's Wreck card (a combo of ×3, topple the
  semi, lose two wheels…), the rest stunt days as today. Still one per UTC day and never repeating a day running.
- The title's card (src/comeback.js) and the results line say which kind today is.
- The streak counts both kinds alike; a missed day is never punished beyond the streak resetting, as today.
- Every wreck objective is met by a careful player on Assist (a scripted check like 0200's).

## Acceptance criteria
- [ ] Unit: the day's kind alternates by UTC day; wreck objectives read only the Wreck card.
- [ ] Each wreck objective is met in a scripted run with one-thumb Assist on a phone.
- [ ] 390×844 touch and 1280×720 keyboard; audits pass.

## Test plan
`tests/unit/daily.test.js` extended; the daily e2e covers a wreck day.

## Out of scope
The iPhone's Daily (follow-up after 0239). A server-side daily board.
