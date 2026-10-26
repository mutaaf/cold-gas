---
id: 0060
title: Finish 0042: audio suspends and unlocks right, the canvas redraws while paused, the screen stays on
status: shipped
priority: P1
size: M
lens: tech-health
created: 2026-10-21
pr: PRNUM
by: operator
---

## Why
0042's input and tilt parts shipped in #67 and its heal parts in #69. What's left is everything a player
hears and sees around a pause:
- The AudioContext is never suspended. Pause and a hidden tab freeze the last gains, so the motor, the
  hiss or the title drone keep playing.
- On iOS, `initAudio` resumes only from 'suspended', not Safari's 'interrupted' (after a phone call).
- Rotating or resizing while paused leaves a blank canvas, because pause skips the render.
- There is no wake lock, so the screen dims during the up-to-35 s judging and the replay.

## What
`audio.suspend()/resume()` on pause, hidden and a long idle title; resume from any non-running state on
the next gesture. Render one frame on resize while paused. `navigator.wakeLock` during runs, judging and
the replay, re-acquired when visible. Close 0042 when this ships.

## Acceptance criteria
- [x] Pause → AudioContext 'suspended'; resume → 'running'
- [x] Resize while paused: canvas not blank (screenshot)
- [x] Wake lock held during judging (where supported), released on the title
- [x] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e in `tests/e2e/lifecycle.spec.js` for each criterion.

## Out of scope
Background audio playback.
