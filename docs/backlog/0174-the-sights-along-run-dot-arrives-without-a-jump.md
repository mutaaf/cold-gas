---
id: 0174
title: On the Show, the sight's along-the-run dot slides in when the slide can act, instead of jumping 14 px in one frame
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-09
pr: 285
by: critic
---

## Why
0165 (#276) made the up/down slide a real control on the Show, and the sight now draws the mark along the run only
while the slide can act on it (`canA`, `src/onethumb.js` `markOffset`). That is right, but the dot arrives in one
frame.

Critique `docs/critique/2026-11-09-1540.md` §2 measured this on main `875cd37`, in Node with the page's own
`markOffset` per tick (the `thumb-mastery` flight, no slide):

| thumb | `canA` opens at | dot y, the tick before → the tick it opens |
|---|---|---|
| held from the tap | h 5.5 m | **0 → 13.9 px** |
| tapped, pressed again 1.0 s | h 5.7 m | **0 → 8.6 px** |
| tapped, pressed again 1.5 / 2.5 s | h 5.7 m | 0 → 1.5 px, then a 4.2 px step at h 5.3 m |

The sight's ring is 44 px (`AIM_R`). A 14 px jump is a third of its radius, or 2.3 m of touchdown. It happens
about 1 s before the wheels, which is the only second the along-run slide has on the held thumb. A thumb parked on
the dot is suddenly off it, with no motion to follow. The dot either teleports (reads as a glitch) or gets ignored
(the slide the player was just taught does nothing). `thumb-aim.js`'s header promises "put your thumb on the dot and
hold it: the touchdown walks onto the mark and the dot stays put". At the moment it opens, the dot doesn't stay put.

## What
`src/thumb-aim.js` (the DOM only; the sim, `markOffset` and the input log are untouched): ease the drawn y toward
`markOffset`'s y whenever it changes by more than 3 px in a frame. Use a critically damped approach of about 0.15 s.
Never overshoot, and never move it the wrong way. `data-ey` keeps reporting the true target, so scripts still read
what the control measures. Alternatively, write the drawn value to `data-ey-shown` and keep `data-ey` as the target.
Mirror it in the Swift HUD only if the native sight draws `canA` the same way.

## Acceptance criteria
- [x] Unit (a jsdom or pure-function test of the easing): fed the per-tick target series of the held Show flight
      (0 → 13.9 px), the drawn y moves ≤ 3 px per 60 Hz frame and reaches the target within 0.25 s, with no overshoot.
- [x] The drawn dot never moves opposite to the target's change.
- [x] `thumb-mastery.test.js`'s re-reading thumb (0.2–0.3 s late, held and tapped) is unchanged or better: held
      ≤ 2 m, tapped ≤ 2.5 m. It reads the target, so it must not change.
- [x] A 390×844 touch frame strip (60 fps, ≥ 10 frames across the moment `canA` opens) in the PR shows the dot gliding.
- [x] Works at 390×844 touch. 1280×720 keyboard has no pad, so no change there.

## Test plan
Export the easing step from `src/thumb-aim.js` as a pure function and unit-test it on the recorded target series.
Then grab the e2e frame strip with the existing one-thumb probe (`tests/e2e/frame-probe.js`'s `thumbFrameTests`
flies a held thumb).

## Out of scope
- When `canA` opens (0165's gate).
- The sideways dot's jump on a lift (0164's known 4–18 px).
- The 3D touchdown ring.
