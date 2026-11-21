---
id: 0355
title: The landed camera never stands in the splash tank, so the touchdown on the mark is seen on a phone again
status: shipped
priority: P0
size: S
lens: player-feel
created: 2026-11-20
pr: 474
by: critic
---

## Why
The touchdown is the moment the whole stunt is judged on. On an upright phone it is now hidden by a wall. On the Show,
#464 (0340) put a splash tank at x 10–18, z −40…−24, with 1.1 m walls (`src/sim/courses.js:213`). The landed rig still
stands where 0119 placed it: car + (12, 1.25, 0) m upright, car + (6.5, 1.25, −9) m wide (`src/render/director.js:61`,
`:503-505`). For a car near the mark (z −30), both stands are **inside the tank**. Its `rowBlocks` check
(`director.js:131`) looks only at the parked row, not the tanks.

The critic measured this on production (`b127d2a`, `index-w4p3OHCC.js`) with the reference run (Perfect 10 · 97.3, on
the rings 1.5 m off the mark). Evidence: `docs/critique/2026-11-20-1500/occ-probe.mjs.txt` → `occ-phone.json.txt`,
`occ-desk.json.txt`.
- **390×844 touch:** the camera stands at x 14.4–16.8, z −26.7…−28.5, 1.4–1.6 m up. That's over the water, inside the
  walls.
  - In **12 of 12** sampled frames from touchdown until the results, the sight lines to **all four** wheel contacts and
    to **all 16** points of the 4 m ring cross the tank's box.
  - The frame (`docs/critique/2026-11-20-1500/phone-ref-touchdown.png`): the car's wheels are cut off by a grey coping,
    then a black wall, a full-width salmon LED bar and teal water. Together they fill the lower 37 % of the screen. The
    rings, the mark and the "on the mark" proof that 0126, 0108 and 0119 fought for are gone.
  - Yesterday's frame at the same tick (`docs/critique/2026-11-19-1530/phone-ref-touchdown.png`) showed the car on its
    rings.
- **1440×900:** the camera stands at x 10.3–12.9, z −33…−36, also inside the tank's walls. It's 1.4 m up, above the
  1.1 m coping and looking away from it, so the frame happens to stay clean (`desk-ref-touchdown.png`: the car on its
  rings, 0 of 4 wheel lines blocked). That's luck, not design: a landing a few metres to the right would put the wall in
  the shot.
- **During the brake:** `phone-ref-rollout.png` shows the tank's corner wall coming across the bottom right of the frame
  while the car is still in the air.

This is a phone-first regression in the core stunt (operator focus 1: the core loop on a phone, the score right after
landing). It's fake-looking too: no film crew puts a camera in the water tank to shoot a car landing beside it.

## What
In `src/render/director.js`, keep every ground stand (the landed rig, and any low descent or brake shot) out of the
course's `surfaces.tanks`, walls included, with a margin. Also keep their sight line to the car and the mark clear of
the tanks:
- Reuse `rowBlocks`'s idea: a `tankBlocks(car, stand)` test from `src/sim/surfaces.js` `tankWalls` (no sim change).
- On a block, swing the stand to the open side (−x on the Show, the side away from the tank), or pull it back and raise
  it above the coping until the sight line clears.
- It's render only: no sim, scorer, vector or `ref-hash` change.

## Acceptance criteria
- [x] On the Show and the Lineup, at 390×844 touch, 393×659 and 1440×900, in the reference run and in a run that comes to
      rest 4 m left and 4 m right of the mark: from touchdown until the results, the camera is never inside any tank's
      box grown by 0.5 m. In every frame, the sight lines to the four wheel contacts and to ≥ 14 of 16 points of the 4 m
      ring don't cross a tank's box. Measured the way `docs/critique/2026-11-20-1500/occ-probe.mjs.txt` does.
- [x] The phone's touchdown frame shows the car on its rings, with the wheels whole. The lower 40 % of the screen is
      floor and rings, not wall, LED or water. Screenshot it beside `docs/critique/2026-11-19-1530/phone-ref-touchdown.png`.
- [x] A run that splashes into the tank still frames the splash. The rig may look into the tank from outside it, but it
      never stands in it.
- [x] 0108 still holds (the car ≤ 0.75 of an upright phone's width), and so does 0119 (the upright landed frame is not
      half black floor).
- [x] An e2e or unit test asserts the stand-outside-tank and clear-sight checks for the Show's reference touchdown at
      390×844.
- [x] No sim, scorer or `ref-hash` change. `npm test` is green.

## Test plan
- A unit test on the director's landed stand: given the Show's surfaces and a car at the mark, the stand is outside
  every tank (+0.5 m) and the stand→wheel segments miss every tank box.
- The 0119/0108 e2e framing spec, extended with the tank-occlusion check at 390×844.

## Out of scope
- Moving or removing the tank. It's the owner's call (0340); the camera works round it.
- The Free Drive and Roam cameras.

## Critic sharpening 2026-11-20 21:45
A second run reproduced this on production (`b127d2a`) with a different probe:
`docs/critique/2026-11-20-2145/cam-probe.mjs.txt` → `cam-probe.json.txt`. It reads `__coldgas.camera.position` every 4
ticks from touchdown to the results.
- **390×844:** the camera eases from (16.7, 1.61, −26.8) to **(13.0, 1.28, −29.7)** while the car rests at
  (0.71, 0.4, −29.9). It's inside the tank's footprint in 10 of 11 frames, and it settles 0.33 m above the 0.95 m water,
  2.6 m inside the near wall.
- **1440×900:** the camera passes through the tank in 3 of 11 frames ((12.9, 1.55, −33.1) → (10.3, 1.43, −35.7)), then
  settles at (7.6, 1.27, −38.5), just outside it.
- So criterion 1 has to hold **for every frame of the ease**, not just where the stand settles. The desktop rig crosses
  the tank on its way to a clean stand.

## Shipped 2026-11-21 (builder)
`src/render/tank-sight.js` (pure) answers whether a ground stand is inside a tank's box grown by 0.5 m, and whether its
sight lines to the car's four wheel contacts and to the 16 points of the mark's 4 m ring cross a tank's box (a tank the
target is in is ignored: the rig may look into one, never stand in it). `src/render/director.js` `groundStand` swings the
Show's landed stand round the car, at the same distance, in 5° steps to the nearest clear bearing (toward +z first, so the
view still runs toward −x), keeps that bearing while it stays clear, and rises over the coping only if no bearing is clear;
`easeGround` cuts to the stand when an eased frame would be blocked (the descent's rig at +21 m eased across the tank).
The Lineup's landed stand goes through the same check (it was already clear). Measured: `tests/unit/landed-stand.test.js`
drives the director at 60 Hz along both references (as flown, ±4 m) at 390×844, 393×659, 1440×900: every frame from the
touchdown on is outside every tank, 4/4 wheels and ≥ 14/16 ring points in sight (9 of its cases fail on main).
touchdown-frame.spec at 390×844: dark share of the lower 40 % 0 / 0 with the turned stand (a first cut that mirrored the
stand to −x read 0.632 and failed 0119); the car 0.556–0.592 of the width (≤ 0.75); desktop widths unchanged.
Known trade: on an upright phone the stand now stands ≈ 40° round toward the row, so the frame's backdrop is the open sky,
not the launch complex 0119 framed; the lower 40 % is lit floor and rings.
