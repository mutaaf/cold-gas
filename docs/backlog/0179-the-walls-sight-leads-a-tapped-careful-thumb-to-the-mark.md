---
id: 0179
title: On the Wall, the sight leads a tapped thumb that follows the dot to the mark
status: proposed
priority: P1
size: M
lens: player-feel
created: 2026-11-10
pr:
by: builder
---

## Why
0177 gave the Wall's tapped thumb (pressed again in the air, most phone players) the whole sideways reach, from its
first roof-up tick. A thumb that holds a slide gets there: (−34, −34) px pressed again at 1.5 s lands 1.8 m from the
mark. A thumb that does what the sight says still doesn't. That thumb re-reads the amber dot every 0.3 s and moves
onto it 0.25 s later (`thumb-mastery.test.js`'s re-reading thumb). It lands 3.7–4.1 m off pressed again at 1.0 s,
6.2–8.2 m at 1.5 s and 8.2 m at 2.5 s, against 0177's bar of ≤ 3.5 m. On the Show and held from the tap it lands
1.5 m off.

Three things in the way (Node, 0177's probe):
- **The dot's radius.** On the Wall the along-run part of the miss is 8–10 m (the slide there is still 0121's direct
  pitch, not a place as 0165 made it on the Show), and `markOffset` clamps the whole dot to `AIM_R` = 44 px. The first
  read is (−20, +39) px when the place needs ≈ −40 sideways.
- **The window.** The tapped car is aimable from 14 m up at 2.1 s to the aim floor at ≈ 3.2 s. A 0.25 s reaction and a
  0.3 s re-read use half of that.
- **The 2.5 s line.** That thumb presses at 7.9 m up. Even a full (−48, −48) px slide lands 7.2 m off. The ≤ 3.5 m bar
  can't be met there by any slide, so the bar for that line needs to change, not the flight.

## What
Measure before choosing. Options:
- Lay the Wall's dot out per axis (each axis clamped on its own, or the sideways part first) so the sideways read is
  the place's.
- Make the Wall's up/down slide a place too (0165's law), so the along-run dot holds still while the car flies to it.
  A first try that used the Show's law unchanged lost along-run reach (a full slide moved 3.8 m less). It needs its own
  gain.
- Show the place from the first roof-up tick of a hold pressed in the air (0177 made it valid there), so the first read
  comes earlier.

## Acceptance criteria
- [ ] Unit: the re-reading thumb on the Wall (both axes, every 0.3 s, 48/60/70 ticks late) lands ≤ 3.5 m from the mark
      pressed again at 1.0 and 1.5 s, and no worse than today at 2.5 s (8.2 m), with no contact and no Rough landing.
- [ ] 0164's and 0177's sweeps pass unchanged; the Show's sight is unchanged.
- [ ] `node scripts/daily-reach.mjs`: every objective over the floor; before and after in the PR.

## Test plan
Extend `thumb-mastery.test.js` with the re-reading thumb on the Wall for the tapped lines (`flyThumb({ course: 'wall',
again })`).

## Out of scope
- The Show's sight and slide.
- The sideways slide's law (0177).
