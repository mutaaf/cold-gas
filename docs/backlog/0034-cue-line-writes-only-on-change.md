---
id: 0034
title: The cue line writes only when it changes, holds each message, and "Go" shows
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-10-21
pr: 70
by: operator
---

## Why
`cues()` (src/main.js ~566-590) calls `ui.cue_` (src/ui.js ~65-70) every frame. Each call builds a
RegExp in `localize` (src/units.js), rewrites `innerHTML`, toggles a class and re-arms a timer, inside a
`backdrop-filter` box: a layout per frame on a phone. Thresholds with no hysteresis (speed < 9.5 m/s,
upY < 0.85) make the text flap between two messages, and the countdown's "Go" is overwritten on the
first live frame so it never shows. This is the most visible DOM flicker in a run.

## What
`ui.cue_`: if the html is unchanged, only extend the hide deadline; check the deadline from `frame()`
instead of a setTimeout. Build the localize RegExp once. `cues()`: enter/exit thresholds and a 400 ms
minimum hold per message; let "Go" hold for its moment.

## Acceptance criteria
- [ ] A MutationObserver on `.cue` sees < 10 writes in a full Show reference run (was hundreds)
- [ ] "Go" is visible for ≥ 400 ms after the countdown
- [ ] No message shows for under 400 ms unless the run ends
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
e2e: run the Show reference with `skipCountdown()` off, observe `.cue` mutations and their timestamps.

## Out of scope
Rewording cues.
