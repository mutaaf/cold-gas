---
id: 0059
title: Check the lockdown in the field: tiers, frame times and errors per device class from production
status: dropped
priority: P1
size: S
lens: performance
created: 2026-10-21
pr:
by: operator
---

## Why
The lockdown was measured in emulation (Chromium, WebKit, a 4× CPU throttle). Real iPhones and iPads
decide whether it worked: does iOS now boot `mid` (0037), does the governor stop stepping down under a
30 fps cap (0044), did error signatures fall (0039–0041, 0048)? Production's observability (PR #58)
already collects tiers, frame times and errors; nobody has read it against the lockdown.

## What
24 h after the P0s are live, read production's `/obs/digest` (`npm run heal -- --check`, then the digest
itself) and write `docs/critique/<date>-lockdown-field.md`: tier and boot reason per device class, p95
frame time per class, governor steps per session, top error signatures before/after. File a ticket for
anything that regressed. Note: the Worker labels tablets `phone-*` until it accepts `tablet` (src/worker
is operator-only).

## Acceptance criteria
- [ ] The field report exists with the numbers above and links each to a ticket or "ok"
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
None (a measurement ticket); the report is the artefact.

## Out of scope
Changing the Worker.


> Dropped 2026-11-02 (scout): stale. The lockdown's P0s shipped and the funnel shows 1 human session, so a per-device-class field read has no data to read; the Critic and `npm run heal` already watch the digest.
