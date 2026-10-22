---
id: 0042
title: Pause, background and return: audio, input and the canvas come back exactly right
status: ready
priority: P1
size: M
lens: tech-health
created: 2026-10-21
pr:
by: operator
---

## Why
- Audio is never suspended: pause/hidden stop `updateAudio` so the last gains hold and the motor, hiss or
  title drone keep playing in the pause menu and a background tab (src/main.js ~673, 962; audio.js).
- iOS: `initAudio` resumes only from 'suspended', not Safari's 'interrupted' (audio.js ~25); the context
  can be created outside a gesture (physics-pending start, sandbox, `?play=`), so the first run is silent.
- Touch state (stick, GO/BRAKE/LIFT, thumb pad, nozzle pad) is never reset on blur/hide/pause.
- Context-loss give-up timer (src/obs/heal.js ~76) runs while hidden, so a backgrounded iOS tab reloads
  and loses results; restore skips Free Drive/Sandbox env maps (scene.js ~528).
- Rotating or resizing while paused leaves a blank canvas (pause skips render).
- No wake lock: the screen dims during the up-to-35 s judging and replays.
- Tilt shows "On" after reload on iOS but needs a permission gesture; rotation keeps the old zero.

## What
`audio.suspend()/resume()` on pause/hidden/idle title; a capture-phase first-gesture unlock and resume
whenever state ≠ 'running'. `resetInput()` on blur/hidden/pagehide/pause. Heal's timer counts visible
time only; restore rebakes the active look. Render one frame on resize while paused.
`navigator.wakeLock` during runs, judging and replay (re-acquire on visible). Tilt: request permission on
the next Jump tap; re-zero on `screen.orientation` change.

## Acceptance criteria
- [ ] Pause → AudioContext state 'suspended'; resume → 'running'
- [ ] Hold GO, fire `visibilitychange` hidden then visible: no input held
- [ ] Resize while paused: canvas not blank (screenshot)
- [ ] `WEBGL_lose_context` while hidden for 20 s: no reload
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e `tests/e2e/lifecycle.spec.js` additions for each criterion.

## Out of scope
Background audio playback.
