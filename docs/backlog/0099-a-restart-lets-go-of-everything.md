---
id: 0099
title: A restart lets go of everything; a held control counts again only on a fresh press
status: shipped
priority: P0
size: M
lens: platform
created: 2026-10-27
pr: 139
by: operator
---

## Why
The operator, 2026-10-27: **"after restarting I often just get stuck in a lift or fly mode."**

Reproduced on main (`370bf2d`) on the real page (Playwright, a 1280×720 keyboard page and a 390×844
touch phone; the sim stepped in the page). `startRunNow()` (Retry on the HUD, R / Enter, the results'
and the theatre's Retry, the pause sheet's Restart, Rookie mode) and `startDrillNow()` never let go of
the input: only pause, blur, pagehide and a hidden tab called `resetInput()`. So whatever was held as
Retry was hit was still held when the new run went live:

| held across the restart | HUD Retry | R | results Retry | theatre Retry | pause Restart | aftermath (HUD Retry) |
|---|---|---|---|---|---|---|
| Space + ↑ + Shift (keyboard) | **fail** | **fail** | **fail** | **fail** | **fail** | **fail** |
| GO (touch, classic) | **fail** | n/a | **fail** | **fail** | pass | **fail** |
| LAND + BOOST (touch, in the air) | **fail** | n/a | **fail** | **fail** | pass | **fail** |
| one-thumb pad | **fail** | n/a | **fail** | **fail** | pass* | **fail** |
| gamepad A + RT | **fail** | | | | | |

- Keyboard: within one second of "Go" the new run's log has `lift`, `level`, `thrust` and `throttle`, the
  car has left the ground (`phase: 'air'`) and `S.released` is true: the "lift or fly mode". Even pause,
  which does clear the keys, loses: the held key's auto-repeat put it straight back into `keys`.
- Touch, classic: `touch.go` / `touch.land` stay true and lit; a finger left on LAND as the run ended
  became Shift's rear boost (`thrust`) on the next run-up.
- One-thumb: `newFlight()` reset the thumb's state but not the pad, so the pad stayed lit while the thumb
  read "not held" (the dead-man brake) until the finger was lifted. (*pause cleared it.)
- During a retry's READY the touch layer still showed the last run's layout (`data-phase="landed"`,
  or LAND in the air) and the one-thumb pad its last words ("Stopping"), because they were only synced
  by the live step.
- Not reproduced in Chromium: a finger lifted while the results hide the touch layer *does* get its
  `pointerup` (captured pointer), so `touch.lift` didn't stay stuck that way here. iOS Safari is unverified;
  resetting at the run's start covers it either way.

## What
- `src/input.js`: `freshRun()` = `resetInput()` + the driver's hands back to rest (`driver.reset()`) + the
  Advanced key ramp shut. `resetInput()` also holds every gamepad off until it has been at rest once
  (`padHeld`, in `copyPads`). A keydown auto-repeat of a key that isn't held no longer holds it
  (`keyHolds`): a key let go of by a reset counts again on its next real press.
- `src/valves.js`: `createKeyRamp().reset()`.
- `src/main.js`: `newFlight()` (every run and drill) calls `freshRun()`; `startRunNow()` syncs the touch
  layer's phase and the one-thumb pad for the new run before the countdown (`syncTouchPhase`).
- A fresh press during the countdown counts (holding ↑ through READY to launch is a choice, not a leftover).
- No sim change: the input log records what the player pressed, as before (invariant 4).

## Acceptance criteria
- [x] Space, ↑ and Shift held across HUD Retry, R, the results' Retry, the pause sheet's Restart and a Retry
      during the aftermath: the new run's first second has no lift / level / thrust / throttle, the car is
      on the ground and not released; a fresh press of ↑ drives
- [x] Touch (390×844): GO, LAND and BOOST held across HUD / theatre / aftermath / pause Retry are let go,
      unlit, and the READY layout is the run-up's; one-thumb held across the results' Retry is let go and
      answers the next press
- [x] A gamepad held across Retry drives nothing until it is let go
- [x] Unit: `keyHolds`, the gamepad hold-off, `createKeyRamp().reset()`

## Test plan
`tests/e2e/restart-lets-go.spec.js` (fails on main, passes with the fix); `tests/unit/input.test.js`,
`tests/unit/learn.test.js`. Existing input, touch, retry, pause and smoke e2e stay green.

## Out of scope
Free Drive and the Sandbox's own reset (`R` there) and their start; a touch's real `pointercancel`
behaviour on iOS Safari (needs a device).
