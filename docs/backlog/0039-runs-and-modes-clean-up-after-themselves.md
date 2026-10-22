---
id: 0039
title: Every run and mode cleans up after itself: no leaked physics worlds, no stale starts
status: shipped
priority: P0
size: M
lens: tech-health
created: 2026-10-21
pr: 70
by: operator
---

## Why
- `freeWorld` only runs when a run reaches 'done' (src/main.js ~232, sim/run.js ~310). Retry mid-run,
  Home, drill retry, a double-tap on Start, or Enter on results while Retry has focus each leak a Rapier
  world: WASM memory only grows, and a long retry session on a phone heads for an OOM tab crash.
- A Start queued while physics loads (src/main.js ~78-84) fires later into whatever mode the player is
  in, including a live Free Drive; several taps queue several starts.
- `toTitle` (src/main.js ~213, also heal's escalation) never tears down Free Drive or the Sandbox: the
  drive world, HUD, `body.driving` and camera far stay over the title.
- A double tap on Sandbox builds it twice (`st.active` set after the awaits, build/sandbox.js ~62).
- `?play` + `?board` / `?play` + `?drive` deep links start both (src/main.js ~1005-1009).

## What
`disposeRun()` called from `startRunNow`, `startDrillNow`, `toTitle`; a single pending-start token
cleared on any mode change; `toTitle` tears down an active drive/sandbox (guarded against recursion);
an in-flight guard on sandbox open; deep-link precedence (drive > play > board), documented in AGENTS.md.

## Acceptance criteria
- [ ] 200 × (startRun → toTitle) keeps Rapier memory within 5 % of the first iteration
- [ ] Start tapped during physics load then Free Drive opened: no run starts
- [ ] Heal's toTitle from Free Drive leaves no `body.driving` and no drive HUD
- [ ] Double-tap Sandbox builds one arena
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e `tests/e2e/lifecycle.spec.js` for each criterion (memory via the engine's memory accessor).

## Out of scope
Free Drive internals beyond teardown.
