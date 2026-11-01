---
id: 0123
title: A first touch on the road, off the pad, answers instead of doing nothing
status: ready
priority: P1
size: S
lens: engagement
created: 2026-11-01
pr:
by: scout
---

## Why
Players funnel (2026-11-01, `/obs/digest → players`): `days` is empty and `total` is 0 human / 0 auto, and the board
has no rows. Nobody has been counted yet (the newest build in the digest's frame data is 75b65db, older than #181's
beacon), so there is no drop-off to read; first-run clarity is the best guess for visit → run.

Played as a newcomer (`coldgas_howto = 'new'`, 390×844 touch): the how-to card is clear, but in the run-up the
one-thumb pad is a ~135 px circle at the lower right (about x 278, y 692). A touch anywhere else on the screen, which
is where a thumb lands on a big phone when the player is just looking at the car, does nothing. My scripted touch at
the screen's centre held for 9 s with the clock running, speed 0, and the cue still said "HOLD THE PAD TO CLIMB".
Nothing on the screen said the touch was seen but missed. A silent miss in the first seconds of a first run is a lost
run.

## What
During the run-up and the climb of a one-thumb run (and only then), a touch that starts outside the pad and outside
every other control briefly pulses the pad (a ring around it for ~400 ms, reduced-motion: a static outline) and the
cue line reads "HOLD THE PAD" once for that run. It must not start the flight, move any sim input, or count as a
press. No sim change, no new copy beyond that one phrase.

`src/input.js`, `src/onethumb.js`, `src/styles.css`, `tests/e2e`.

## Acceptance criteria
- [ ] At 390×844 touch, one-thumb, Assist on: a touch at (195, 420) during the run-up pulses `[data-onethumb]`
      (class or attribute the test can read) and leaves `S.input` untouched (no valve, no pad press).
- [ ] A touch on the pad, the top bar, a pause sheet or a result sheet behaves exactly as before.
- [ ] The pulse shows at most once per 3 s and never during results, the countdown, a replay or desktop pointer use.
- [ ] `prefers-reduced-motion` gets a static outline, no animation.
- [ ] ref-hash, determinism and 32/32 naive landings unchanged; hud-audit clean at 390×844, 360×780 and 844×390.

## Test plan
Playwright e2e with `hasTouch`: start The Show, tap the how-to's Got it, dispatch a touch off the pad, assert the
pulse and an unchanged input log, then touch the pad and assert the climb. `npm run check:fast` locally.

## Out of scope
Making the whole screen a pad (it would fight the stick and the nozzle pad on Pro and Advanced).

Which funnel number it should move: `run` / `visit-new`, and `run-landed` on a first run.
