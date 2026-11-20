---
id: 0355
title: The landed camera never stands in the splash tank, so the touchdown on the mark is seen on a phone again
status: ready
priority: P0
size: S
lens: player-feel
created: 2026-11-20
pr:
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
- [ ] On the Show and the Lineup, at 390×844 touch, 393×659 and 1440×900, in the reference run and in a run that comes to
      rest 4 m left and 4 m right of the mark: from touchdown until the results, the camera is never inside any tank's
      box grown by 0.5 m. In every frame, the sight lines to the four wheel contacts and to ≥ 14 of 16 points of the 4 m
      ring don't cross a tank's box. Measured the way `docs/critique/2026-11-20-1500/occ-probe.mjs.txt` does.
- [ ] The phone's touchdown frame shows the car on its rings, with the wheels whole. The lower 40 % of the screen is
      floor and rings, not wall, LED or water. Screenshot it beside `docs/critique/2026-11-19-1530/phone-ref-touchdown.png`.
- [ ] A run that splashes into the tank still frames the splash. The rig may look into the tank from outside it, but it
      never stands in it.
- [ ] 0108 still holds (the car ≤ 0.75 of an upright phone's width), and so does 0119 (the upright landed frame is not
      half black floor).
- [ ] An e2e or unit test asserts the stand-outside-tank and clear-sight checks for the Show's reference touchdown at
      390×844.
- [ ] No sim, scorer or `ref-hash` change. `npm test` is green.

## Test plan
- A unit test on the director's landed stand: given the Show's surfaces and a car at the mark, the stand is outside
  every tank (+0.5 m) and the stand→wheel segments miss every tank box.
- The 0119/0108 e2e framing spec, extended with the tank-occlusion check at 390×844.

## Out of scope
- Moving or removing the tank. It's the owner's call (0340); the camera works round it.
- The Free Drive and Roam cameras.
