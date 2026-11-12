---
id: 0213
title: Native Free Drive is designed for a world without an edge (research and design doc)
status: shipped
priority: P1
size: M
lens: platform
created: 2026-11-11
pr: 328
by: operator
---

## Why
The owner (2026-11-11): "unlock a free drive mode within the same game map with semi infinite rendering using the
latest and greatest in open source metal and game repos, think superior innovation here". NATIVE.md §1 left Free Drive
out of v1. Before any code, the choices (terrain LOD, streaming, precision far out, physics, upscaling, assets) have
to be made against the iPhone's 120 Hz budget and our rules: permissive licences only, no remote packages, and the
scored sim left alone.

## What
Runs on: the operator's Mac. Documentation only.
- `docs/NATIVE-FREEDRIVE.md`: a survey of current open-source Metal and game tech, each item with its licence and a
  verdict (take, skip or later) and the reason. It covers Metal 4 and 4.1, MetalFX, residency sets, argument tables,
  ICBs, mesh shaders, meshoptimizer, CDLOD, geometry clipmaps, concurrent binary trees, a floating origin, background
  streaming, virtual texturing, Jolt and Rapier, and noise libraries. Then the frame budget, the world, the drive and
  the phases.
- NATIVE.md §1 points at it.

## Acceptance criteria
- [ ] Every candidate the owner named has a verdict and a licence.
- [ ] The frame budget is split by system against NATIVE.md §4's measured stage.
- [ ] The phases map to tickets 0214–0216.

## Test plan
`node scripts/check-backlog.mjs` green. Read by the owner.

## Out of scope
Code. The Sandbox, builds, side quests and the rocket's flight stay out of the app.
