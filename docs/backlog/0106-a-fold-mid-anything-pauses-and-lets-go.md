---
id: 0106
title: A fold mid-run pauses the run and lets go of every touch; a fold paused, on the results or in the replay re-lays out
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-27
pr:
by: operator
---

## Why
0075 kept a run going through a fold. But a fold is the player's hands leaving the glass: the controls
move (the pad from a 382 px screen's corner to a 669 px one's), a finger that was on GO is now nowhere, and
the browser may never send its `pointerup` (WebKit cancels; a resize can swallow it). Measured on the
simulated device (0102), the size settles 10–400 ms after the first event and the orientation type is
wrong in between, installed or in a tab. The run carries on blind for that time. And a fold while paused,
on the results or in the replay has no test.

## What
- `src/main.js`: on a settled resize that changes the screen drastically (area by more than a third, or
  the orientation by the size's own aspect, never `screen.orientation`), a live run or countdown on a touch
  screen pauses (the pause sheet, `resetInput`: 0099's let-go, so a finger still down counts again only on
  a fresh press). Resume carries on the same run. A small resize (a toolbar) never pauses.
- The decision is pure (`src/fold.js` `drastic(prev, next)`), unit-tested.
- e2e: fold mid-run (paused, same run, nothing held, Resume continues), mid-pause, mid-results, mid-replay
  (re-laid out, nothing off the glass, a drawn frame after the settle: no black frame).

## Acceptance criteria
- [ ] Mid-run fold (both directions, both orientations): `S.paused`, the same `S.run`, nothing held; Resume and the tick advances.
- [ ] A held GO through the fold is not held after Resume until pressed again.
- [ ] A 60 px toolbar resize never pauses; a desktop window resize never pauses.
- [ ] Mid-pause, mid-results and mid-replay folds: the sheet/peek is on the glass, its buttons reachable; the canvas is not blank after the settle.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
`tests/unit/fold.test.js` (drastic); `tests/e2e/fold.spec.js` updated (the mid-run fold now pauses) and new cases.

## Out of scope
Auto-resume (the player chooses when the car moves again).
