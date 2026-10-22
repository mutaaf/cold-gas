---
id: 0048
title: Every network call has a deadline, a cancel and a single flight
status: shipped
priority: P1
size: M
lens: tech-health
created: 2026-10-21
pr: 69
by: operator
---

## Why
- Road download (drive/load.js ~14) has no timeout and `st.loading` blocks every Drive press until a
  reload; Back while loading still drops you into the drive.
- A failed Endless start never disposes its world (drive/index.js ~166,173): terrain workers and GPU
  buffers leak. A 404'd terrain worker crash-loops then sets `busy=Infinity` silently; `indexedDB.open`
  has no timeout (world/cache.js ~46-57) and can hang on WebKit, saturating workers.
- Board/scores (panel.js ~18-23, main.js ~935, 950): no timeouts, 'today' can overwrite 'all',
  "Verifying…" can hang forever, Submit can post twice, a malformed row throws in `ui.board`.
- The judges' deadline finishes the show but never aborts the stream (ai/theatre.js ~258, 333).
- "Replay the call" can run twice and garble the typewriter (ui.js ~411).

## What
A shared `fetchWithDeadline(url, {ms, signal})` helper; AbortController + cancel token for roads;
dispose on Endless failure; 1.5 s IndexedDB open timeout; treat worker load failure as stale build;
board requests keyed by sequence; Submit disabled in flight; tolerant row rendering; theatre aborts its
stream in `finish()`; replay-the-call guard and cancelled timers.

## Acceptance criteria
- [x] `/roads/*` that never answers: an error card within 20 s and Drive works again
- [x] Board: slow 'today' after 'all' doesn't overwrite 'all'
- [x] Double-click Submit posts once
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e with `page.route` stalls; unit test for `fetchWithDeadline`.

## Out of scope
Changing the Worker (frozen).
