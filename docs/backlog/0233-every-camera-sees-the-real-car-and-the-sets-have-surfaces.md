---
id: 0233
title: Every camera sees the real car, the first screens aren't blown out, and the sets have surfaces (iPhone)
status: in-progress
priority: P0
size: M
lens: player-feel
created: 2026-11-13
by: operator
---

## Why
A playtester, through the owner, 2026-11-13:
- the car must convince from every camera, the scored runs' included;
- the starting light is too bright on the car;
- the environment needs textures: road, concrete, metal, the stunt sets' ramps, walls and poles too.

## What
Runs on: the operator's Mac (Xcode).
- The forged car (0232) drawn on every course: the title, the Show, the Wall and the Lineup. It's pixels only (the sim never
  sees a mesh), and `-roadster` brings back the old one.
- The bloom's threshold is 1.6, not the web's 0.82. A white car under the set's searchlights no longer blooms into a glowing
  blob on the title and a run's opening, while the LEDs, lamps, beams and jets keep their glow (`-web-bloom` for
  comparison). The paint's albedo is a real white's (≈ 0.6), for the car's contrast against the set.
- The sets' surfaces get procedural detail (Shaders.metal effect 13, world-space, no texture memory). Concrete gets big
  stains, a mottled mid tone, aggregate up close, and tyre marks and oil on the level. Metal gets brushing, scratches and a
  varying finish. `-flat-sets` turns it off.
- The paint's flakes show only up close (further off they read as noise).

## Acceptance criteria
- [ ] `make test` (the 52 run vectors bit-exact) and `make rules` green.
- [ ] Before and after shots in docs/shots/0233/: the title, the Show's opening, the Wall's climb, the Lineup's opening,
      the Show's set on a roam.

## Out of scope
Collision and physics (another agent's), the SwiftUI screens (another agent's).
