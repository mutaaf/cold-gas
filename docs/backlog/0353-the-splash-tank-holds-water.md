---
id: 0353
title: The splash tank holds water: its surface, the crown, the ring and the spray read as water in every look
status: shipped
pr: 467
priority: P1
size: M
lens: player-feel
created: 2026-11-19
by: operator
---

## Why
At a scored splash-down (0340) the tank read as a black box with sparks and no water was visible (#465's
show-splash-replay shots).

## Root cause
- The tank's water is the stage's static `water` plane, baked from the web's `buildSurfaces` by scripts/native-stage.mjs:
  a MeshPhysicalMaterial of near-black teal (0.002, 0.016, 0.024 linear) at 90 % opacity over a near-black floor. The
  exporter keeps neither its night emissive nor its ripple bump, and on the night set its mirror saw the dark: black.
- The crown went into the crash's puff pool, which draws dust "lit by the night" at a third of its colour: grey smoke.
- WATER's surface, splash and spray are Free Drive's world layer, and a scored set has no world.

## What (pixels only: physics, vectors and the stage files untouched)
- **The surface** (Shaders.metal `cg_setwater_fragment`, its own pipeline, chosen in `drawMesh` by Material.flags.w bit 32,
  which SetSurface.classifyWater sets on the stage's `water` plane with the tank's size): ripples that drift (five short travelling waves, slopes summed analytically), the set's floodlights'
  GGX glints on them, the stage's environment mirrored with Fresnel, the red LED lip mirrored at the walls, a teal body lit by
  the lamps that reach it, a wet line against the concrete. Anime: the body through the cel ramp, a hard Fresnel band, the
  glints as stars, the lip as a flat red stripe, white water as solid inked shapes. 8-bit: the same in whole blocks, stepped
  at 8 fps, the palette's blues.
- **The ring** (Frame.splash, from SetWater: where, its age on the track's clock, how hard): a train of crests running out at
  ≈ 3.5 m/s, its first crest white, the churn where the car went in; **the car's ripples** (Frame.wade) while it's in the tank,
  with a bow wash when it moves.
- **The crown and the spray**: WATER's own drops (`WaterFX.splash` / `.sheet`: up and out, a sheet ahead, gone in the water
  they fall back into or on the slab), drawn by a new set spray pipeline (`cg_setspray_*`) lit per vertex by the set's lamps.
  The puffs stay, fewer, as the mist over it.

## Measured
A first cut put the water in a branch of `cg_stage_fragment`: with the tank filling the frame (`-fx-cam top`, Real, the
simulator) a frame took ≈ 40 ms against 3.8 ms before, and a constant colour in the same branch was back to 4 ms. The branch's
weight was on the whole uber-shader. In its own pipeline it's 4.6 ms (Real) and 1.6 ms (Anime) on the same frame.

## Acceptance criteria
- [x] At splash-down the tank's water, crown, ring and spray read as water in Real, Anime and 8-bit (docs/shots/0350/).
- [x] `make test`: 58 run vectors bit-exact.

## Test plan
Simulator, each look: `-replay splash-show-wide -fx-cam top -holds 14.25,14.5,14.9,15.8` (and without `-fx-cam`, the replay's own camera), before and after (docs/shots/0350/); the frame's cost against the before build on the same frame (`-holds 14.5`); `make test`: 58 run vectors bit-exact.
