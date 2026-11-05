---
id: 0159
title: "The car's small physical details in Metal: torn-off parts, lamps and hazards, aero and skirts, shock diamonds and mist, the searchlights' sweep"
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
The owner, on the iPhone app: "remember all the little details like wheels spinning, physics and impact to environment need to be
carefully addressed". 0153's list still had what crash.js, debris.js, roadster.js, plumes.js and wall.js update draw.

## What
Runs on: the operator's Mac (Xcode, Metal).
- `scripts/native-stage.mjs` exports the car's moving and lit parts, crash.js's boxes, the parked cars' paints and the searchlights'
  pivots, each from the web's own objects. Two web lines, no change to what the web draws: `scene.js` exports `blobMaterial`, each
  searchlight's pivot carries its sweep numbers.
- The exporter drew only one face of a lone box (a geometry's groups count only with an array of materials, as in three). Fixed: the
  stage gains about 3,100 triangles it should always have had.
- `CarState.swift` (roadster.js update), `Debris.swift` (debris.js), `Plumes.swift` (plumes.js); `Crash.swift` tears parts off, crazes
  the canopy, fails the lamps, sets the hazards, and throws chips in the struck car's paint.
- The touchdown's rings and shake from `run.t.touchTick` and `run.t.sink`.

## Where native differs from the web, on purpose
- debris.js has the corner's lever arm backwards: `a` is n × r where its comment says r × n. Run headless, its parts gain energy and
  climb up to 85 m. Native uses r × n, and they skid and settle flat. The web still has it (a separate one-line fix, with a flicker pass).
- The mist's pool is 500 (the web's low tier, its density rule), not 1800.
- A mist or dust particle is sized by the screen's width, not its height: on an upright phone the web's rule draws it 2.6× wider than
  the same particle on a landscape screen. Its depth comes from a point nearer the lens, so the slab doesn't cut it along a hard line.
- The rings also show in a recorded run: the title's loop is one.

## Acceptance criteria
- [x] Each detail seen in a simulator shot (`-replay`, some with `-fx-cam`): parts torn off and settling, lamps out, hazards blinking, the
      canopy crazed, chips in the struck car's paint (a one-off build with a loud paint), wing, skirts, brake bar, wake, cones, mist, rings, sweep.
- [x] `make rules`; `npm run -s vectors -- --check` (the sim is untouched).
- [ ] The cost on the Pro Max. Nothing here has been benched on hardware: `make device`, `-bench`, then `-gpu-skip mist,plumes,beams`.
      At the governor's floor (0.5) the mist's worst moment in the reference Show is 1.8 M fragments (`-fx-log`), about twice the screen.

## Test plan
`-bench` on the phone beside 0153's numbers; `make rules`; the web's unit tests; `npm run -s vectors -- --check`.

## Not in this ticket
The crash cut and the touchdown's dip and punch-in (the director's). Bloom and the lamps' glows (the film pass has none yet). The title's
idle breath from the jets (the title here is a recorded run).
