---
id: 0026
title: On a portrait phone the telemetry strip never sits over the car it reports on
status: dropped
priority: P1
size: S
lens: player-feel
created: 2026-10-21
pr:
by: critic
---

Dropped 2026-10-21: replaced by 0061 (the phone HUD collapses to one slim line off the car's path; measured by the same occlusion probe, at 0 frames).

## Why
The point of the livestream's channels (0018) is to read them while watching the car do what they
describe. On a portrait phone the strip covers the car. Measured on production 2026-10-21 16:00
(docs/critique/2026-10-21-1600.md), Show reference, 390×844 touch. The car's projected centre
(`carRoot` through `camera`) was sampled every frame against `.h-strip`'s bounding box (y 268–381 px):

- **The car's centre is behind the strip in 36 of 159 frames (23 %).** That's **31 of 80 frames on the
  climb (39 %)** (car y 294–493 px) and 5 of 41 in the air (car y 61–447).
- Over the row the hero car is drawn behind the G and N₂ cells
  (`docs/critique/2026-10-21-1600/phone-5-over-row.jpg`, and `2026-10-21-0945/phone-5-over-row.jpg`
  before it). This was first noted at 09:45 and left to 0018, which shipped (#44) without moving the block.
- At 844×390 and 1440×900 the same probe gives 0 of 159 frames. Only portrait is broken.

On the most-used device, a player can't watch the climb and read PITCH at the same time.

## What
- `src/styles.css` (portrait phone media query) and, if needed, `src/render/director.js`. Pick one:
  move the strip out of the car's screen band (e.g. dock it under the top bar or above the touch
  controls), or frame the portrait chase/air camera so the car stays clear of the strip. Keep every
  shown channel (SPD, ALT, SINK, G, N₂ kg/bar, PITCH, FAN) at ≥ 11 px with 4.5:1 contrast.
- No sim change.

## Acceptance criteria
- [ ] e2e or script (the probe in the critique, against the build): through the Show reference at
      390×844 and 430×932 portrait, the car's projected centre is inside the strip's box in **0 frames**,
      and inside the strip's box grown by 24 px in **≤ 2 %** of frames.
- [ ] 844×390 and 1440×900 stay at 0 frames (no regression).
- [ ] `node scripts/hud-audit.mjs` phones set: 0 overlaps, 0 text < 11 px, 0 labels < 4.5:1 at every phase.
- [ ] Before/after screenshots at 390×844 of the climb, the carry over the row and touchdown in the PR.
- [ ] One-thumb and classic touch controls still reachable (`scripts/thumb-reach.mjs`, no new overlap).

## Test plan
Add the occlusion probe (project `__coldgas.carRoot` with `__coldgas.camera` each frame, compare
with `.h-strip`'s rect) as a phone e2e that flies `startRun('reveal')` with `skipCountdown()`.
Mind the flake guard in LESSONS: a new spec file or a slow test with `test.slow()`.

## Out of scope
New channels, desktop layout, the timeline/ROLL labels (0022).
