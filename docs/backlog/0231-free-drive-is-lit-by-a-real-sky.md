---
id: 0231
title: Free Drive is lit by a real sky (golden hour, a physical atmosphere, surfaces with detail, grass, the ground under the car)
status: shipped
priority: P0
size: L
lens: player-feel
created: 2026-11-13
pr: 361
by: operator
---

## Why
The owner, 2026-11-13, after #344, #348, #350 and #352: "we are missing the mark — the quality isn't there." In
docs/shots/0226 and 0227 everything is flat vertex colour under a dim, flat night: a uniform dark slab of asphalt, smooth
gradient verges, untextured grey mountains, nothing on the ground, nothing sitting on it. A player should see the leap in
the first second.

## What
Runs on: the operator's Mac (Xcode).
- A physically based sky (Hillaire 2020 / Bruneton: Rayleigh, Mie, ozone, multiple scattering) drawn from three small
  LUTs, with the sun's disc, clouds, and the stars after dusk. The sky lights the frame: the key light is the sun through
  the air, the ambient and the paint's reflections are the sky's, the haze is the sky's own aerial perspective.
- A time of day: golden hour by default, then sunset, blue hour, night, morning, midday and a running day, on a sun
  button in the drive's HUD (remembered); `-fd-tod <preset|hour>` for shots; 0226's painted dusk kept as `classic`.
- Long shadows from the trees and the roadside onto the road, the land and the car.
- Procedural surfaces: asphalt with aggregate, patches, repairs, sealed cracks, polished wheel tracks, worn paint; land
  with grass patches, soil, rock with strata and snow by slope and height; foliage lit through by a low sun.
- Grass near the eye: instanced blades on the land drawn, none on the road or the rock, swaying.
- The ground under the car darkened by it (analytic ambient occlusion from its footprint).
- Every new pass behind the renderer's quality (its shed: heat, Low Power Mode, a frame over budget at the resolution
  floor) and `-fd-quality`. The bench's per-pass times charged without the buffers' overlap.

## Acceptance criteria
- [x] `make test` + `make rules` green, the 52 run vectors bit-exact (nothing in the sim changes).
- [x] Before and after shots at the same poses (mountain road, forest road, coast road, the Show's set on a roam, the car
      in the cinema camera) in docs/shots/0231/, the after dramatically better.
- [x] Bench before and after (simulator; the phone's is the owner's) (docs/NATIVE-FREEDRIVE.md §8), per-pass times.
- [x] The 1.2.0 notes and What's-new card say so.

## Test plan
`cd ios && make test && make rules && make bench-freedrive`; simulator shots with `-fd-km <n> -fd-cruise 0`.

## Out of scope
The car's own model (0232).
