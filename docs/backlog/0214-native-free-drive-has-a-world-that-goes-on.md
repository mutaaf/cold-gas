---
id: 0214
title: Native Free Drive has a world that goes on, around the Show's own apron
status: shipped
priority: P1
size: L
lens: platform
created: 2026-11-11
pr: 329
by: operator
---

## Why
Free Drive on the iPhone should start where the game lives (the Wall, the row, the pad, the launch complex) and then
never run out: land, roads and the things beside them, to the horizon, at 120 Hz. docs/NATIVE-FREEDRIVE.md §4.

## What
Runs on: the operator's Mac (Xcode).
- `ColdGasWorld` (ios/Packages/ColdGasCore, pure, Foundation only):
  - the web's noise in Swift;
  - the land: four isotropic biomes, the 3 km floor kept flat, the ground carved to the roads;
  - lattice roads: a jittered junction per 1,024 m cell, Hermite links, a 9 % design grade, banking;
  - the prop scatter, and the tile and ribbon builders.
  Everything is a pure function of (seed, coordinate).
- The app's world view (ios/ColdGas/World):
  - a CDLOD quadtree with geomorphing and skirts;
  - tiles built on a background queue into pooled slabs;
  - roads and instanced props;
  - everything drawn camera-relative (a floating origin), in a blue-hour look.
- A prop interface (`PropSource`) with a procedural source. The forge's assets plug in as a second source.

## Acceptance criteria
- [ ] The same seed and coordinate give the same land, roads and props, whatever order they're asked in (unit tests).
- [ ] The Show's floor is flat (0 m) and no road or prop stands on it.
- [ ] Simulator screenshots of Free Drive near the complex and about 5 km out, looked at.
- [ ] `make test` green, with the 0186 known-issue rows left as they are.

## Test plan
`WorldTests` in ColdGasCore:
- determinism (repeat runs, any order of asking);
- the land is continuous across tile edges;
- the roads keep to the grade limit, and links agree where they meet at a junction;
- props stand off the roads and off the floor.

Screenshots via `-freedrive`.

## Out of scope
Driving it (0215), GPU-driven culling and meshlets (v2), MetalFX temporal upscaling (v2).
