---
id: 0043
title: The first Jump starts instantly: the reference ghost is flown before you press it
status: shipped
priority: P1
size: S
lens: performance
created: 2026-10-21
pr: 70
by: operator
---

## Why
`refGhost` (src/main.js ~167-173, called from `startRunNow` ~236 and `startDrill` ~866) flies a whole
reference run, ~3,450 Rapier ticks, synchronously on the first Jump per course: ~0.13 s on desktop and
~0.7 s on the 4× phone profile. The tap looks dead before the countdown appears.

## What
Compute each course's reference ghost on the title once physics is ready, in ≤ 5 ms slices
(`scheduler.yield` / setTimeout fallback); `syncGhost` already tolerates a missing ghost.

## Acceptance criteria
- [ ] No long task > 50 ms between the Jump tap and the countdown's first frame (phone profile)
- [ ] The ghost is present on the first run when the title was shown ≥ 2 s
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e with a PerformanceObserver('longtask') around `startRun` under CPU throttling.

## Out of scope
Moving the sim to a worker.
