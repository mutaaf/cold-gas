---
id: 0320
title: Water you can drive into (iPhone Free Drive and Roam): a real sea in three looks, and a car that floats, wades, drowns, splashes and comes out dripping
status: in-progress
priority: P1
size: L
lens: authenticity
created: 2026-11-19
pr: 460
by: operator
---

## Why
The owner, 2026-11-19: "we're still not really great at this landscape realism, the water realism, effects of the
environment on the vehicle on the environment … every bit of damage, every bit of effect, cause and effect is considered,
and realistic … across the real, anime, and 8-bit versions", with the fewest re-renders and caching considered. In the
iPhone's Free Drive the sea was the terrain's own vertices painted a flat dark blue at −2 m, and driving into it reset the
car the moment it was a metre under.

This is the WATER track beside LANDSCAPE (0310–0319) and MATTER. Unscored: nothing here reaches a scored run.

## What
- **The sea, pure** (ColdGasWorld `Water.swift`): two cascades of Gerstner waves (256 m swell, 32 m chop) that tile their
  squares exactly, sized to a sea state 3 (≈ 0.9 m significant height) and never folding; the drawn surface's height at a
  point (the sideways Gerstner shift inverted) so the car floats on what's drawn; depth maps round a point; the land's
  skyline from a point (the reflection's).
- **The terrain draws the seabed** under the water (it was flattened to the sea's level), with caustics in the shallows
  and the swash zone's wet, glossy sand (`World/Water.h`, one call from World.metal's terrain fragment).
- **The surface** (`World/Water.swift`, `World/Water.metal`): a compute pass bakes both cascades into 256² textures
  (displacement + Jacobian, slopes + their second moment, mipmapped) at a capped rate per look (60 Hz Real, 24 Anime, 10
  8-bit), never per pixel; one draw for all the water to 40 km (a polar grid round the camera), calmed toward the shore by
  CPU depth maps (1 km at 4 m, 8 km at 32 m, 41 km at 320 m) built off the main thread only when the camera has moved far
  enough. Nothing is baked or drawn with no sea within 20 km.
  - Real: Schlick Fresnel; the reflection is the dusk sky plus the land's skyline mirrored from a 512-bearing horizon row
    (the ranges in the water without drawing the world twice); a GGX glint from the moon and the headlamps, rough by the
    slopes' spread (LEAN-style: the far sea neither sparkles nor goes to glass); Beer–Lambert through the refracted path
    to the bed with coastal sea water's absorption and in-scatter; whitecaps from the swell's Jacobian; foam lines rolling
    up every shore; the haze.
  - Anime: flat cel water in three depth bands, a hard Fresnel band of the sky, bold star glints, foam as solid shapes
    with an ink line.
  - 8-bit: banded depth and sky, sparkle tiles stepped four times a second, solid foam pixels.
  - The wake (a ribbon that spreads and fades over ≈ 8 s) and spray (drops with gravity and drag that die in the water).
- **The car in the water** (ColdGasPhysics `Buoyancy.swift`, one call from `driveStep`): Archimedes over 3 × 4 columns of
  the body (it pitches, rolls and bobs on the swell); the cabin floods once the sills are under and the car sinks; the
  water's quadratic drag on the wet faces and the tyres (driving in at speed is a wall of water, wading has a speed);
  tyres grip wet (×0.8) and aquaplane in a film from 55 % of the NASA hydroplaning speed; the drive unit trips past 0.5 m
  of wading and comes back once dry; how wet the car is and how high the water reached (exposed for MATTER to shade the
  paint: `DriveCarLook.wet`, `.wetLine`); loose things float or sink by what they're made of (`floatLoose`).
- **Cause and effect on the frame:** a splash where the car meets the water (drops, mist, the splash sound, a soft thud
  in the hands, a shake if it's big), sheets off the nose's corners and the bow's wake, rooster tails off wet tyres, drips
  off a wet car, a rumble while wading, the tyres' wet hiss, the lens kept above the water, cues ("Afloat", "Drive unit
  flooded", "Drive unit back", "Towed out of the water"). The watchdog no longer resets a car the moment it's in the sea:
  only drowned for 6 s, adrift 25 s, or 40 m down.
- Signposts water-waves, water-maps, water-draw; the bench's passes line has `water`; `-fd-skip water` leaves it out.

## Acceptance criteria
- [x] `make test` green with the 52 run vectors bit-exact (Vehicle.swift untouched).
- [x] Unit tests for the sea (tiling, sea state, no folding, determinism, NaN, the floating height matches the drawn
      surface, depth maps, skyline) and for the car (Archimedes, float/flood/sink, wall of water, wading, stall and
      restart, drying, splash, same bits twice, NaN water is no water, loose things float or sink).
- [x] Simulator shots of the sea in Real, Anime and 8-bit (docs/shots/0320/).
- [ ] GPU cost ≤ 1.5 ms on an iPhone 17-class phone in Real (measured on the simulator only, see the PR; the device
      command is in the PR for the owner).

## Test plan
- `cd ios && make test` (BuoyancyTests, WaterTests, RunVectorTests).
- Simulator ("ColdGas iPhone", `-mute`): `-freedrive -look real|anime|pixel -fd-at 2960,2872,46 -fd-hold 0.6,0,1.5` drives
  into the sea 4.2 km from the apron; the car wades, floats, the drive unit floods; `-fd-stats` prints the ground under it.
- Cost: Release, `-bench` with and without `-fd-skip water`, the passes line's `water` and `main`.
