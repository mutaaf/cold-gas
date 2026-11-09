---
id: 0178
title: In the iPhone app, the sight's along-the-run dot glides in when the slide can act, as on the web
status: proposed
priority: P2
size: S
lens: player-feel
created: 2026-11-09
pr:
by: builder
---

## Why
0174 made the web pad's sight glide its along-the-run dot onto the target when `canA` opens (0 → 13.9 px in one
frame on a thumb held from the tap, 0 → 8.6 px pressed again 1 s after it) instead of jumping. The native sight draws
the same `markOffset(…, canA)` (`ios/ColdGas/Game/Game.swift` `refreshHud`) and sets `mark.position` straight
(`ios/ColdGas/Input/ControlSurface.swift` `update`, implicit animations off), so on the iPhone it still jumps. The
cloud builder can't compile or run the app, so this is the operator's.

## What
Runs on: the operator's Mac (Xcode). iPhone app only; no sim, scorer or vector change.
- Port `glideStep` (src/thumb-aim.js: GLIDE_JUMP 3 px, ω 24, ≤ 3 px a 60 Hz frame scaled to the frame's dt, toward the
  target only, never past it, snap on show, on a non-finite target and on a frame over 0.1 s) into
  `ThumbSurfaceView.update` for the mark's y (x stays as it is, out of scope as on the web).
- At 120 Hz the bound is the same speed (180 px/s), so ≤ 1.5 px a frame.

## Acceptance criteria
- [ ] A Swift test fed tests/unit/thumb-aim-glide.test.js's 13.9 px step: ≤ 3 px per 1/60 s, on the target within
      0.25 s, no overshoot, never the wrong way.
- [ ] On the Pro Max simulator, a held one-thumb Show: the dot glides when canA opens (screen recording).

## Test plan
`make test`, then the Show on one thumb on the Pro Max and closed Duo simulators.
