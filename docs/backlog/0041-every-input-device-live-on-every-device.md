---
id: 0041
title: Keyboard, gamepad and touch all work on every device, and keys never stick or misfire
status: ready
priority: P0
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
- One-thumb is the touch default and its path (`sampleThumb`, src/main.js ~391, 496) reads no keys and
  no pads: on an iPad with a Magic Keyboard or a phone with a controller, arrows/Space/pad do nothing.
- Touchscreen laptops, Surface and Chromebooks never get touch controls: the overlay shows only when
  `coarse || usingTouch()` (src/main.js ~245, 855), and `usingTouch()` needs a press on a hidden control.
- After a mouse click on Retry/Home/mute/ghost, Space (LIFT) re-fires that button on keyup
  (src/input.js ~36 skips preventDefault on focused buttons): the run restarts mid-flight.
- Escape/P toggle pause on every key repeat; Cmd+Arrow leaves an arrow stuck on macOS; `select` and
  `textarea` leak keys to the game; gamepad Start doesn't pause; cues show "Hold ↑" on phones in Classic.

## What
`input.js` tracks the last device used per tick; thumb mode falls through to `sample()` when a key or pad
is active and hides the touch overlay; a document `pointerdown` with `pointerType==='touch'` (or
`any-pointer: coarse`) shows it. Blur `.top button`s after mouse clicks. `!e.repeat` on toggles; ignore
`metaKey` keydowns and clear keys on Meta up; one shared editable-target guard; Start = pause; cue glyphs
follow the last device.

## Acceptance criteria
- [ ] iPad emulation (touch + isMobile), Show, ArrowUp held: car moves within 2 s
- [ ] Desktop with a touch tap on the canvas shows the touch overlay
- [ ] Click Retry, press and release Space: same run continues
- [ ] Holding Escape toggles pause once
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e for each criterion; unit tests in `tests/unit/` for the last-device arbitration in input.js.

## Out of scope
Gamepad menu navigation.
