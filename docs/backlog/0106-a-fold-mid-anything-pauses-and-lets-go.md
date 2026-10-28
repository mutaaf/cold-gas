---
id: 0106
title: A fold mid-run pauses the run and lets go of every touch; a fold paused, on the results or in the replay re-lays out
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-27
pr: 148
by: operator
---

## Why
0075 kept a run going through a fold. But a fold is the player's hands leaving the glass: the controls
move (the pad from a 382 px screen's corner to a 669 px one's), a finger that was on GO is now nowhere, and
the browser may never send its `pointerup` (WebKit cancels; a resize can swallow it). Measured on the
simulated device (0102), the size settles 10–400 ms after the first event and the orientation type is
wrong in between, installed or in a tab. The run carries on blind for that time. And a fold while paused,
on the results or in the replay had no test. (A phone turned mid-run pauses too, for the same reason: every
control moves under the thumbs.)

## What
- `src/main.js` `foldPause`: on the first resize that changes the screen drastically against the size it
  last settled at (500 ms quiet), so a fold's transient sizes count at once (area by more than a third, or
  the screen turned by its own aspect, never `screen.orientation`, which is stale for a few ms), a live run,
  a countdown or a Free Drive on a touch screen pauses (the pause sheet, `resetInput`: 0099's let-go).
  Resume carries on the same run. A small resize (a toolbar, an inset coming and going) never pauses.
- The decision is pure (`src/fold.js` `drastic(prev, next)`), unit-tested.
- e2e: fold mid-run (paused, same run, nothing held, Resume continues), mid-pause, mid-results, mid-replay
  (re-laid out, nothing off the glass, a drawn frame after the settle: no black frame).

## Acceptance criteria
- [x] Mid-run fold (382×580 → 466×498 → 669×871 and back; 594×368 → 867×589 → 951×589 and back): paused at the first size, the pause sheet up, the same `S.run`, the clock stopped, nothing held; a tap on Resume and the tick advances (e2e).
- [x] A thumb held on the pad through the fold is not held after the fold (`held().thumb` false, nothing lit), and counts again only on a fresh press (0099's let-go) (e2e).
- [x] A toolbar's worth of resize (35 px) mid-run never pauses (e2e); a fine pointer (a desktop window) never pauses (by design: touch screens only); a flip cover screen turning (near-square) isn't a turn (unit).
- [x] Paused, a fold re-fits the sheet with Resume and Home on the glass; on the results the action row stays on the glass through a fold; in the replay the peek's buttons stay on the glass and the replay plays on (e2e). (A blank canvas after a resize while paused: lifecycle.spec, 0060.)
- [x] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
`tests/unit/fold.test.js` (drastic); `tests/e2e/fold.spec.js` (the mid-run fold now pauses, lets go, resumes); `tests/e2e/lifecycle-fold.spec.js` (a toolbar resize; a fold paused, on the results, in the replay; its own file so it runs in the lighter CI shard).

## Out of scope
Auto-resume (the player chooses when the car moves again).
