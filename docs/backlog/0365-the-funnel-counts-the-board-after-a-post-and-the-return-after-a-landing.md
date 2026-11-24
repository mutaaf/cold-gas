---
id: 0365
title: The funnel says whether a posted player opens the board and whether a landed player returns the next UTC day
status: proposed
priority: P2
size: S
lens: engagement
created: 2026-11-24
pr:
by: scout
---

## Why
The funnel reads 4 `visit-return` in 14 days against 17 `visit-new` (24 %), and zero `board-open`. We cannot say whether
a returning visit followed a landing, a Post or a Daily, so no retention ticket can be aimed. 0303 counts what is pressed
on the card; this adds the two missing links, as counts only (no ids, no cookies beyond the existing local flags).
Funnel number to move: it moves none by itself; it makes `visit-return` per `run-landed` readable.

## What
- `src/main.js` / `src/obs`: when a visit is counted `visit-return`, also count exactly one of `return-after-landed`,
  `return-after-wreck` or `return-after-post`, from a local flag (`coldgas_last_end`: `landed|wreck|post`, UTC day) written
  at the end of each decided run and each Post. Clear the flag when read.
- `board-open` already exists; count `board-open-posted` when the board is opened from the posted state of the card.
- Add the names to `PLAY_EVENTS` in `src/obs/signature.js` (Worker accepts any listed name; do not touch `src/worker/`).

## Acceptance criteria
- [ ] Landing on day N, then a new visit on day N+1, counts one `visit-return` and one `return-after-landed`, never twice for one visit.
- [ ] No flag, no extra count; storage blocked leaves the funnel unchanged and throws nothing.
- [ ] No personal data, no new host; `scripts/obs-report.mjs` prints the new columns.

## Test plan
Unit over the flag reader with a stubbed clock; e2e with the clock advanced a day.

## Out of scope
Notifications, reminders, streak mechanics.
