---
id: 0292
title: Every vehicle looks real and is our own design (the roadster, the semi, the launch vehicle and tower, the lineup)
status: shipped
priority: P1
size: L
lens: authenticity
created: 2026-11-18
pr: 436
by: operator
---

## Why
The owner: "better realistic accurate depictions of all the vehicles": the hero roadster, the semi, the rocket and its
launch tower, and the rest of the lineup. Two IP flags came first: the hero's faceted wedge read as a well-known angular
electric pickup, and the launch vehicle on its lattice strongback as a real launch company's. Invariant 3.7: no brands, no
real product names, no recreation of any manufacturer's or space company's specific design.

## What
Render meshes only. The sim's bodies, colliders and dimensions (`src/sim/`) are untouched; the scored runs are bit-exact on
the web and the iPhone (52 vectors).

- **The Cold Gas Roadster** (`src/render/roadster.js`): an original low two-seat electric roadster on the sim's box
  (4.33 × 2.00 × 1.15, wheelbase 2.825). A smooth loft (curved sections, curved in plan and profile) in place of the
  faceted wedge: a long hood sunk between rounded fenders, a raked screen into a short glass canopy, a fastback to a
  ducktail deck, broad rear haunches. Arches cut round each axle; five split-spoke forged wheels dished to a recessed hub
  with lug nuts; a ventilated rotor and a caliper behind the spokes; tyres with sidewall bulge and tread grooves. Corner
  lamp units with smoked lenses and light blades (no full-width light bar), an L tail lamp, mirrors, wipers, flush handles,
  a charge door, side intakes, carbon sills, a cabin. Every part the app animates keeps its contract (`carParts()`).
- **The semi and the lineup** (`tools/forge/archetypes/`, `forgekit.py`'s wheel, promoted to `public/forge/`; the
  semi's, pickup's and cab's procedural fallbacks in `src/render/parked/`): the semi an original flat-fronted electric
  cab-over (split windshield, separate lamp clusters, mirrors on arms, battery packs, hub-piloted dual wheels); the pickup
  a conventional crew-cab with an open bed and tailgate (no faceted wedge, no light bar); the cab with corner lamp pods;
  every forged car with shut lines, wipers, tyre sidewalls and tread, brakes behind split spokes.
- **The launch vehicle and tower** (`src/render/rocket.js`, docs/ROCKET.md): a reusable booster (nine bells under an
  open flared skirt, leg pods, steering vanes, its own livery) carrying a winged stage-separation orbiter (double delta,
  fin, body flap, tiled belly) on an 8-strut adapter, beside an original fixed service tower (clad service levels, a lift
  and stair core, umbilical arms, a crew arm and white room, a hammerhead crane). Everything a car can reach stays inside
  the sim's colliders; only the wings, 55 m up, pass the old fairing's radius.
- **The iPhone** shows the same meshes: `scripts/native-stage.mjs` regenerates the stages; only the vehicles' sections of
  each stage.json change (the sets' own sections keep main's bytes).

## Acceptance criteria
- [x] The roadster no longer reads as a faceted wedge or pickup: smooth curved panels, its own light signature.
- [x] Wheels with spokes, brakes behind them and tyre sidewalls; mirrors, wipers, handles, glass, lamps, panel lines.
- [x] The semi, the sedan, the crossover, the pickup and the cab are original, detailed designs.
- [x] The launch vehicle carries a winged orbiter; the tower is an original fixed service tower.
- [x] No sim change: `npm test` and `cd ios && make test` (52 vectors) pass.
- [x] Triangles and draws measured before and after, and kept within a phone's means.
- [x] Before and after shots on the web and the iPhone (docs/shots/0292/).

## Test plan
- `npm test` (unit, including the seam and forge-native checks), `npx vite build`, `npm run e2e` specs that cover the
  title, the lineup and the forge (`smoke`, `forge`, `first-title`).
- `cd ios && make test`: the 52 run vectors bit-exact.
- `node scripts/shots-car.mjs <out> <preview url>`: the hero from seven angles and active; budget printed.
- `node scripts/shots-lineup.mjs <out> <preview url>?forge=1 lineup`: each parked vehicle and its budget.
- `node scripts/native-stage.mjs show wall lineup`, then the app on the simulator: the title, `-fx-cam front|rear|top`,
  `-cam close`, the Lineup.
