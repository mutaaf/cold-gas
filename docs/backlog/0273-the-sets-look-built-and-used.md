---
id: 0273
title: The sets look built and used: concrete, steel, joints, rubber, crew paint and dressing on the Show, the Wall and the Lineup (iPhone)
status: shipped
priority: P0
size: M
lens: authenticity
created: 2026-11-17
pr:
by: operator
---

## Why
The owner (2026-11-17): "the game, the stunt, and the roam on those things need to be 100x better". The 11-13 playtest:
the environments look flat and need textures. On the phone the Show's and the Wall's slab was one black sheet with a
mirror on it, the Lineup's a flat brown plain; the curl's deck and the steel had no surface at all, and nothing stood on
the sets but the stunt's own fixtures. PR #365's procedural detail (per-pixel noise) cost its main pass 16 ms on the Duo
and waits on a phone benchmark; this is the cheap road: one baked texture.

## What
Runs on: the operator's Mac (Xcode). Pixels only: no collider, mass or tick in a scored run reads any of it.
- **Surfaces** (`Render/SetSurface.h`, `SetSurface.swift`, `Resources/Stages/set-detail.png` from
  `ios/scripts/bake-set-detail.swift`): the static stage's lit, opaque materials are classed concrete or steel (metal ≥ 0.5)
  and read one 512² linear RGBA texture twice in world space (a 4 m tile for the grain and the brushing, a 37 m tile for
  wear and stains), one planar projection by the face's axis.
  - Concrete: the trowel's cloud and aggregate, worn patches, oil drops, rubber smudges and skid arcs, dried tide lines,
    dust on the dry patches (the black slabs read by it), saw-cut joints every 6 m (anti-aliased by the pixel's footprint),
    the run line's rubber, grime at a wall's foot. The wet slab's damp and mirror stand off the dust and out of the joints.
  - Steel: brushing, scratches, a varying finish, grime kicked up its lower 1.4 m.
- **Dressing** (ColdGasPhysics `dressingSet`, the shapes in `LooseView.mesh`): tyre stacks, 200 L drums, flight cases, a run
  of precast safety barrier and a towable generator, our own designs in the set's palette, placed ≥ 6 m off every run's
  line and ≥ 8 m from the pad. A scored run draws them as one static mesh (`Render/SetDressing.swift`); a roam stands them up
  as loose bodies (0274).
- **Crew paint** on the slab: STAGE 1 · THE SHOW, STAGE 2 · THE WALL, STAGE 3 · THE LINEUP, KEEP CLEAR hatching by the
  curl's foot and the row, CREW and UNIT B bays, NO JETS ON THE APRON, run chevrons. Michroma with stencil bridges, worn
  by noise, in one 2048 × 1024 atlas made at launch; lit, translucent decals.
- `-flat-sets` (any build) turns all of it off, for comparisons.

## Cost
- GPU: two bilinear-mipmapped fetches and ≈ 40 ALU ops on a set pixel (the car, the parked row and the effects never take
  the branch); one draw for the dressing (≈ 13 k triangles on the Show, 9 k on the Lineup) in the shadow, mirror and main
  passes; one translucent draw of ≤ 9 quads. No per-pixel noise. The simulator's GPU timings aren't a phone's, so the
  phone figure waits on `make device-bench` (the owner's call).
- Memory: 0.35 MB (the detail with mips) + 11 MB (the paint atlas with mips, shared by every set; could halve as R8).
- CPU: the atlas's wear pass at the first renderer's build, off the main thread.

## Acceptance criteria
- [x] Before/after frames of each set at the mark and mid-run (sim): the slab has joints, wear, stains and damp patches; the
      dressing and the paint read.
- [x] `make test`: the 52 run vectors bit-exact (nothing in the scored world changed).
- [x] The dressing stands still where it's put, clear of every scored line (SetDressingTests).
- [x] The start lights' cap (0270) untouched: the car's materials never take the branch.

## Out of scope
Free Drive's land and roads (another ticket's); the car's look (#365); re-exporting the web's stages.
