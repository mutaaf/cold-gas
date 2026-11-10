---
id: 0183
title: New in 67823c7: page unclean "previous session ended without pagehide"
status: shipped
priority: P0
size: M
lens: tech-health
created: 2026-11-10
pr: 290
by: operator
obs: ca54b0d16a38@67823c7
---

## Why
Production's observability digest (`GET /coldgas/api/obs/digest`, filed by `scripts/heal.mjs`) flags this as **new** against the previous build. Players hit it in the field; nobody reported it.

- Signature key `ca54b0d16a38` (sig `4a693c0d73ef` in 67823c7), module **page**, kind **unclean**.
- Message: `previous session ended without pagehide`
- Top frame: `none`
- Build 67823c7: 2 occurrences in 2 session(s), 66.7 % of sessions' worth.
- Not seen in any earlier build in the 14-day window.

## What
Reproduce from the stack and fix the cause in whatever ran out of memory or hung: check the frame regressions too. The self-heal layer (src/obs/heal.js) already contains it in the page; the fix removes it. It is new in 67823c7: `git log -5 67823c7` names the suspects.

## Acceptance criteria
- [ ] A unit or e2e test reproduces `previous session ended without pagehide` and passes after the fix
- [ ] Key `ca54b0d16a38` is absent from the next build's digest regressions
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse
- [ ] No frame-time regression (e2e perf probe within budget)

## Test plan
Add the failing test first (tests/unit for logic, tests/e2e for a flow), fix, then confirm the next digest no longer lists the key.

## Out of scope
Silencing the error or widening the self-heal: the point is to remove the cause.
