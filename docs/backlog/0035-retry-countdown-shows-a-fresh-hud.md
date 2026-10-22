---
id: 0035
title: A retry's countdown shows a fresh HUD, not the last run's numbers
status: ready
priority: P0
size: S
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
On Retry the countdown branch (src/main.js ~686-690) only sets the clock. `ui.resetHud`
(src/ui.js ~119) resets smoothing but not the DOM or its `last` cache, so READY shows the previous
run's speed, altitude, a red BLOWDOWN gas state, G, the roll arc and timeline states, then they all snap
back on the first live frame. Every player who retries sees it.

## What
`resetHud` resets every `last.*` to its sentinel and writes start values; `startRunNow` calls
`ui.hud(initial)` once before the countdown.

## Acceptance criteria
- [ ] After a finished run, pressing R shows N₂ 655 lb / "Reg", speed 0, timeline at 01 during the countdown
- [ ] No HUD cell changes value between the countdown's first frame and the first live frame except the clock
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: finish a run, press R, read `[data-air]`, `[data-n2-state]` and the timeline during countdown.

## Out of scope
Countdown visuals.
