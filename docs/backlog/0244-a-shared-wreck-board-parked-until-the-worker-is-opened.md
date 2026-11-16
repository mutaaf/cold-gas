---
id: 0244
title: A shared Wreck board (parked until the operator opens the frozen Worker)
status: proposed
priority: P2
size: M
lens: engagement
created: 2026-11-13
pr:
by: operator
---

## Why
Wreck Club (operator's call 2026-11-13) keeps Wreck bests on the device first (0238). A shared board needs the server to
score Wreck from the telemetry, as it does Style (invariant 5), and `src/worker/` and `wrangler.jsonc` are frozen.

## What
**Parked: needs the owner to open `src/worker/` (and possibly `wrangler.jsonc`). No agent builds it until then.**
Depends on: 0237, 0238.
- The Worker scores Wreck with 0237's `wreckRun` from the client's telemetry, behind boardCheck-style plausibility bounds
  for every number it reads, and stores it beside the Style row (never blended).
- `GET /coldgas/api/scores` gains a Wreck board per course; the game shows it as a tab.

## Acceptance criteria
- [ ] The owner has opened `src/worker/` for this ticket (recorded in AGENTS.md).
- [ ] A Wreck entry is scored on the server; a client-sent Wreck number is ignored.
- [ ] `scripts/board-probe.mjs` covers a dry Wreck entry.

## Test plan
Worker unit tests for the Wreck bounds; board-probe dry run.

## Out of scope
Blending Style and Wreck into one board.
