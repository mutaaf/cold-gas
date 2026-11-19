---
id: 0340
title: The scored runs splash and sink: water and mud on the Show and the Lineup, bit-exact on web and iPhone
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-11-19
pr:
by: operator
---

## Why
The owner, 2026-11-19: "yes make the scored runs react to water and mud too". Free Drive is getting water you can drive
into (0320) and ground that keeps the marks (0330); the stunt sets were dry concrete, and the scored physics was off
limits. Now it isn't, for water and mud: a long or wide landing should end in a splash, a muddy roll-out should plough,
and the panel should say so, without moving a single bit of any run, replay, ghost or board score from before.

## What
- **Course data, not code paths** (`src/sim/courses.js` `surfaces`, `src/sim/surfaces.js`): splash tanks (concrete walls
  on the slab, water to a level) and mud ellipses (a material and a sink depth). The Show: a tank off the landing's left
  (x 10–18, z −40…−24) and a mud pit well past the pad (z −50…−60). The Lineup: a tank off the landing's right (between
  the floodlight poles), a mud pit past the pad and a soft patch beside the run-up (off the line). The Wall: none.
- **Physics** (`vehicle.js` `water`, `world.js`): buoyancy by the submerged fraction of four body columns (5.0 m³ sealed,
  flooding to a fifth over ≈ 10 s), quadratic drag (capped: a quarter's drag at most halves its speed a tick), the
  splash-down's slam (half the closing speed, 15 % along the surface, 40 % of the spin), tyres at half grip on a flooded
  floor. Mud: MATERIALS.mud (grip 0.4, Crr +0.12, loose), and a tyre's ray settles up to 4–6 cm in, so a launch off a
  muddy run-up is slower. Only + − × ÷ √, the same order in Swift (Vehicle.swift, World.swift, Surfaces.swift).
- **Identity**: `SURFACE_VERSION` 33 for the Show and the Lineup only (`simVersionOf`); the Wall stays 32. A v32 run on a
  wet set replays on the set as it was (`courseAt`, `replayable`): challenge links (web and iPhone), ghosts, the coach.
- **Scoring**: a splash-down is a crash with its own verdict, "Splash", telemetry `splash`, `splashTick`, `splashSpeed`,
  `mudTime` and card facts `splash`, `splashKmh`, `mudS`, only on a wet set (every older card is byte-identical). The
  panel's local lines (web and iPhone) speak to a splash and a muddy roll-out; the stunt name says "into the tank".
- **Seen, heard, felt**: `src/render/surfaces.js` (tanks with a red LED lip, water, mud decals; the splash crown and ring,
  the wake, mud off the rear tyres), baked into the iPhone's stages by `scripts/native-stage.mjs` (every look);
  `ios/ColdGas/Render/SetWater.swift` (the same spray into the crash's puff pool); audio (web `splash`/`setSurfaces`,
  iPhone `Sound.splash`, wet and soft tyres in mud); haptics (web `buzz('splash'|'mud')`, iPhone `HapticKind.splash` and a
  duller rumble in mud and water).

## Acceptance criteria
- [x] The 52 run vectors from before are byte-identical (`npm run vectors -- --check` before the new files); every input,
      coach, client and challenge vector too.
- [x] Six new run vectors (splash-show-wide, mud-show-long, ref-show-dry-wet, mud-lineup-runup, splash-lineup-wide,
      mud-lineup-long) pass bit-exact in Swift (`cd ios && make test`: 58 run vectors).
- [x] The references fly the wet sets to the same bits as the dry ones; the Daily's populations (thumb, keys, Pro) keep
      their verdicts on the Show and the Lineup (the tanks stand off the line a roll-out takes).
- [x] A splash ends the run "splash" 3 s after the water, verdict Splash, total ≤ 35; no NaN at 30 m/s into the water.
- [x] A full-throttle start through mud is ≥ 10 % slower than on the slab beside it, and the car sits lower in it.
- [x] The Worker (frozen) accepts a wet run's telemetry as it is: course ids unchanged, new keys pass `cleanTelemetry`.
- [x] Works at 390x844 touch and 1280x720 keyboard (the sets' new meshes are static; the spray is pooled).

## Test plan
- `tests/unit/surfaces.test.js`: the data and queries, fairness (pads and lines dry, tanks off to the side), every old run
  keeps its bits (references wet = dry; a v32 log replays dry where the set is wet now), the splash (verdict, end, float,
  no NaN, slowed and never thrown back), mud (slower start, settles in), the panel's lines, challenge identity.
- `tests/unit/vectors.test.js`, `challenge.test.js`: legacy vectors replay at their own version.
- Swift: `RunVectorTests` (58 vectors at their own version), `SurfaceTests` (identity, queries, challenge links),
  `LooseTests` (the cone run moved clear of the Show's tank in Free Drive).

## Out of scope
- Free Drive's water and matter (0320, 0330): their renderers replace `src/render/surfaces.js` and
  `ios/ColdGas/Render/SetWater.swift` when they land (notes in both files). Roam and Free Drive get the tanks' walls
  (solid, as drawn) but not the float or the mud: their car is DriveCar's.
- A Wreck board and the Worker's own words for a splash (src/worker is frozen; the board accepts the run, its words
  come from the AI brief as before).
