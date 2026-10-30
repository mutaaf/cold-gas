---
id: 0057
title: A network blip never breaks Free Drive, the Sandbox or the judges for the rest of the session
status: shipped
priority: P1
size: S
lens: tech-health
created: 2026-10-21
pr:
by: operator
---

## Why
Found in 0040/0048 (#69): `loadDrive` and `loadSandbox` in src/main.js keep a rejected import promise
forever, so after one failed chunk fetch Free Drive or the Sandbox stays broken until a reload. And the
theatre's "too long" deadline still counts against the persisted judge breaker even when a slow chunk
load spent most of the 35 s, so one bad connection can switch the AI judges off for later sessions.

## What
Drop the cached promise on rejection (retry on the next press, with the stale-build check from 0040);
don't count chunk-load time against the judge breaker, only the provider's own time.

## Acceptance criteria
- [x] Abort `drive-*.js` once: the first Free Drive press shows an error, the second works
- [x] Theatre chunk stalled 30 s then the provider answers late: the judge breaker count doesn't rise
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e in `tests/e2e/network.spec.js` with `page.route` abort-once and stall.

## Out of scope
The Worker (frozen).
