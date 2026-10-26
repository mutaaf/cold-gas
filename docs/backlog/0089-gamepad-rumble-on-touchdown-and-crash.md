---
id: 0089
title: A gamepad rumbles on the jets, the touchdown and a crash
status: proposed
priority: P2
size: S
lens: platform
created: 2026-10-26
pr:
by: scout
---

## Why
Pillar 5 says gamepad is first-class, and touch already has haptics (`src/touch-settings.js`, `navigator.vibrate`), but a
connected pad is silent in the hands: `grep -n "vibrationActuator\|playEffect" src/` finds nothing. The landing is the
moment of the game; a dual-rumble pulse on touchdown (scaled by sink rate) and a long rumble on a crash is the
cheapest way to make it felt. API: `gamepad.vibrationActuator.playEffect('dual-rumble', {...})`, see
https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator/playEffect (Chromium and Safari 17+ support it; Firefox
has none, so it must no-op).

## What
A tiny pure module `src/rumble.js` mapping events (jets level, touchdown sink rate, crash impact speed) to
`{duration, weakMagnitude, strongMagnitude}`, called from the existing touchdown/impact hooks in `src/main.js`, gated by a
"Rumble" toggle next to the touch haptics setting (default on, saved on this device), and off under
`prefers-reduced-motion`. Feature-detected; never throws.

## Acceptance criteria
- [ ] Touchdown at 1 m/s gives a short light pulse; at 6 m/s a strong one; a crash a ≥ 600 ms strong rumble
- [ ] No pad, no `vibrationActuator`, or Firefox: nothing happens, no console error
- [ ] The toggle is keyboard-reachable and the choice survives a reload
- [ ] No per-frame allocation (effects fire on events only), no sim change, `SIM_VERSION` untouched

## Test plan
Unit: the event → effect mapping is monotonic in sink rate and clamped to 0..1. e2e: stub `navigator.getGamepads` with a
fake actuator, run the reference jump, assert `playEffect` was called at touchdown and not while the toggle is off.

## Out of scope
Trigger rumble, per-valve rumble, any sound change.
