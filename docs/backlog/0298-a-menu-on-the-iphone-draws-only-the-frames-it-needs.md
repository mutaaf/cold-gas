---
id: 0298
title: On the iPhone a menu draws only the frames it needs: 60 on the title and the results, 15 under a sheet or a pause
status: shipped
priority: P1
size: S
lens: performance
created: 2026-11-18
pr: 447
by: operator
---

## Why
The owner (2026-11-18): idle menus shouldn't render at 120 Hz. The stage drew at the governor's cadence everywhere: on a
ProMotion phone the title's slow loop, the results' slow orbit, a paused run (a held frame) and the stage behind a sheet that
is 94 % opaque were all drawn 120 times a second, the most frames for the least to see. Every one is a full frame: the
shadow, the main pass at 4× MSAA, bloom, film, MetalFX.

## What
- `Game.stageHz`: a run, a drive, a replay and the encore get the governor's cadence; the title and the results 60; a sheet
  (Board, Settings, How to, Practice, the Club) or a paused run 15. The stage view takes the lower of that and the governor's.
- The tools (the turntable bench, a recorded run's shots, the haptics demo) stay uncapped. Backgrounded, the link was
  already paused; that stays.

## Acceptance criteria
- [x] `make perf`: the sheet and paused scenes ask for 15 Hz and draw ≈ 15 fps; the title asks for 60 (a phone's 120 before)
- [x] A run, Roam and Free Drive ask for the governor's cadence, as before
- [x] `make test` passes

## Test plan
`cd ios && make test`; `make perf` (simulator: its display tops out at 60, so the title's change shows on a phone, the
sheet's and the pause's on both); `make device-bench-all` on a phone (the owner).
