---
id: 0144
title: A first run-up that has waited 4 s with no touch lets the pad breathe once
status: proposed
priority: P2
size: S
lens: engagement
created: 2026-11-04
pr:
by: scout
---

## Why
Played as a first-time visitor on a 390×844 touch phone (`coldgas_howto='new'`, Show): after "Got it · Jump"
the countdown ends, the car sits at 0 mph on the run-up, and the only cue is a small bar at the top, "HOLD
THE PAD TO CLIMB", while the pad (lower right, "HOLD · CLIMB") is a dark circle that looks the same as at
+0 s. At +5.0 s on the run-up clock nothing had moved. A first-time player who looks at the car, not the
corner of the screen, can sit there; the funnel shows 9 runs from 5 people with only 3 landings, so the first
seconds matter. This is not a nag: one slow pulse of the pad's ring, once per install, only while the run-up
is idle on the first run, and it stops at the first touch.

## What
`src/onethumb.js` / `src/styles.css`: after 4 s of run-up with no touch on a first-ever run (the existing
howto-seen flag says first), add a `breathe` class to the pad ring (opacity only, ≈2 s, two cycles, then
off), respecting `prefers-reduced-motion` (a static brighter ring instead). Never repeat on later runs or
after a retry; never during the countdown, the climb, or the flight. Check first that the pad does not
already animate on the run-up (the still at +2.5 s and +5.0 s looks identical); if it does, drop this ticket.

## Acceptance criteria
- [ ] First run, no touch for 4 s of run-up: the pad ring animates, twice, then rests; the first touch ends it at once
- [ ] No animation on any later run, a retry, Pro/Advanced, or with reduced motion (static ring only)
- [ ] 390×844 touch screenshot before/after is attached to the PR; no layout shift, no HUD audit regression

## Test plan
e2e at 390×844 touch with `coldgas_howto='new'`: wait 4.5 s on the run-up, assert the class; touch, assert it
is gone; second run asserts it never appears.

## Out of scope
Sound, vibration, text changes, any pause or timer on the run.
