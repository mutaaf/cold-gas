---
id: 0232
title: The drive's car reads as a real car (a forged body with panel gaps, glass and an interior, real tyres and rims, flaked paint, grime)
status: in-progress
priority: P0
size: L
lens: player-feel
created: 2026-11-13
by: operator
---

## Why
The owner, 2026-11-13: "make the car look way more real too". Behind the chase camera the Free Drive car is the stage
roadster: a flat-shaded white wedge with about 1,000 triangles of paint, plain wheels and an opaque canopy
(docs/shots/0225, 0226). It reads as a placeholder in every shot.

## What
Runs on: the operator's Mac (Xcode, Blender).
- A forged body for Free Drive and the roams (tools/forge/car/build.py, Blender, deterministic). It is built over the
  roadster's own skin, so every animated part still fits. It has bevelled panels, cut panel gaps and shut lines, flush
  handles, mirrors, wipers, an intake, a diffuser, arch liners and an underbody, tinted glass over seats, a wheel and a
  dash, and lamp units with reflectors behind clear lenses. Baked occlusion and a grime mask come with it. It has a 10 k
  LOD past 32 m, and a check script (tools/forge/car/check.py).
- Open spoked rims with lug nuts and a barrel, tyres with a sidewall and tread, ventilated rotors and calipers. They are
  built for one side and mirrored for the other.
- The paint gets metallic flakes under the clear coat. Road grime builds up with the kilometres (faster off the road)
  and is washed off on a reset; `-fd-grime` sets it for shots. The crash still dents the body and crazes the glass. The
  lamps follow the car's states by name.
- Nothing in the physics changes. The scored runs keep the stage roadster, and `-fd-roadster` brings it back in a drive.

## Acceptance criteria
- [ ] `make test` + `make rules` green, the 52 run vectors bit-exact.
- [ ] `python3 tools/forge/car/check.py` passes; the forge's turntables in docs/shots/0232/.
- [ ] Before and after shots at the same poses (front, rear, above, the cinema camera, the chase on a road) in
      docs/shots/0232/.
- [ ] Bench before and after.

## Test plan
`cd ios && make test && make rules && make bench-freedrive`; simulator shots with `-fx-cam front|rear|top`.

## Out of scope
A new silhouette; damage decals beyond the dents.
