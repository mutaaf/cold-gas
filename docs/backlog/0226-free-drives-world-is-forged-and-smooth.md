---
id: 0226
title: Free Drive's world looks made, not placeholder (smooth land and road cuttings, forged trees, rocks and roadside, a better blue hour, a minimap)
status: in-progress
priority: P1
size: L
lens: player-feel
created: 2026-11-13
pr:
by: operator
---

## Why
The owner, 2026-11-13: "we need the free drive to be 100x better". Out in the world the trees, shrubs and boulders are
the procedural placeholders (faceted cones and lumpy icospheres, docs/shots/0223/off-road-into-the-trees.png), the land
beside the roads shows its 4 m and coarser steps, and there's no map to say where you are.

## What
Runs on: the operator's Mac (Xcode, Blender).
- Forge slots for the world's props (deterministic, seeded, no brands), exported to the app's prop format; the app's
  `ForgeProps` reads them.
- Smoother land: normals that don't facet, road cuttings without jagged edges.
- A better blue hour and fog out in the world.
- A minimap on the drive's HUD, through the HUD layout editor's API.

## Acceptance criteria
- [x] `make test` + `make rules` green, the run vectors bit-exact; tests/unit/forge-native.test.js and a HudPrefs test added.
- [x] Shots in docs/shots/0226/ (with a before), clearly better than docs/shots/0220, 0223 and 0224.
- [x] Bench before and after (docs/NATIVE-FREEDRIVE.md §8).

## Test plan
`cd ios && make test && make rules && make bench-freedrive`; `npm run forge -- <slot>` for each new slot; simulator shots out in the world.

## Out of scope
New roads or biomes.
