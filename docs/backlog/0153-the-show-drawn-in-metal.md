---
id: 0153
title: "Phase 2: the Show drawn in Metal (stage, row, plumes, director), with headroom at 120 Hz"
status: in-progress
priority: P1
size: L
lens: platform
created: 2026-11-04
pr: 253
by: operator
---

## Why
Phase 1 (0152) made the native sim the web's, bit for bit, and the spike (0148) drew the car alone at 120 Hz. That
measurement is the warning: the car alone took 6.6 ms of GPU at full resolution with 4× MSAA on an iPhone 15 Pro Max,
of an 8.3 ms frame. The whole stage (the Wall, the row, the complex, the plumes and mist, the film look) has to fit
in the same budget, so MetalFX and the resolution governor come with it, not after.

## What
Runs on: the operator's Mac (Xcode, Metal). docs/NATIVE.md §4.
- `scripts/native-stage.mjs` exports the stage from the web's own builders (scene.js `COURSE_BUILDERS`): the Wall's
  deck and truss, the parked row, the pad's rings, the lights, the canvas textures (done).
- Metal passes: cascaded shadows, the floor reflection, the plumes (shock diamonds) and mist as compute, the film look
  (bloom, tone, grain).
- The director's rigs, from src/render/director.js, holding the horizontal lens.
- The car drawn from the Swift sim's state between ticks (interp.js), at 120 Hz.
- MetalFX temporal upscaling and the resolution governor: judged against the display's cadence, pixels first
  (src/obs/ledger.js's rules); thermal state and Low Power Mode feed it.

## Acceptance criteria
- [ ] (2026-11-04, cool iPhone 15 Pro Max: presentation p95 8.34 ms met, GPU p95 6.54 ms at render scale 0.50, 0.04 ms over.) The reference Show replays on the Pro Max at 120 Hz: presentation p95 ≤ 8.34 ms and GPU p95 ≤ 6.5 ms
      (`-bench`). **Not yet:** GPU ≈ 12 ms at render scale 0.5 on a cool run. Later runs were thermally throttled
      (thermal 2) and don't count.
- [x] 0 pipeline compiles after launch; the binary archive covers every pass (87 ms of setup on a warm launch).
- [ ] Shots of the same moments as scripts/shots-look.mjs, beside the web's. Native shots of the climb, the hang and
      the landing exist; the side-by-side with the web doesn't yet.
- [x] The thermal state and Low Power Mode cap the render scale (the governor steps pixels, not the frame rate).

Every per-tick detail the web draws, from the sim's state (the owner, 2026-11-04: "all the little details like wheels
spinning, physics and impact to environment need to be carefully addressed"). Each is checked in a shot or a recording:
- [x] Wheels: spin from `wheels[i].spin`, the fronts' steer, suspension travel at `wheelCenterY(compression)`
      (main.js syncCar). The roadster is exported as a body plus four wheels, each split into a steering part and a
      spinning part.
- [x] The parked row shoved, tipped or rolled as the sim moves it (posed per tick).
- [x] Impacts from `run.impacts`, ported from crash.js with its per-event seeding (the same sparks as the web), checked
      on `-replay crash-show-carry5 -crash-log`:
      - sparks (ballistic, drag, one bounce, cooling white → red);
      - glass, carbon and paint chips tumbling to rest;
      - dust rings and scrape dust;
      - the contact flash and the vented nitrogen line;
      - the camera's shake and the slow-motion beat (the replay's clock slows).
- [x] Dents from each probe's crush, the hero's and the parked cars' (Dents.swift).
- [x] From crash.js and debris.js (0159): torn-off parts as debris, lamps flickering out, hazards, the canopy crazing, chips in
      a struck parked car's paint. A struck car's rock on its springs is the sim's, posed per tick, as on the web.
- [ ] The crash cut (the director's; not in 0159).
- [x] The car's states as roadster.js shows them (0159): brake lamps, wing and aero, vanes, barge boards, skirts, the wake sweep,
      nozzle core and rime. The fan rotors spin but are too dark in the diffuser to see in any shot.
- [x] The plumes' shock diamonds and condensation mist (plumes.js), and the touchdown's rings (0159). The mist's pool is 500, the
      web's low tier's, drawn denser; the phone's cost isn't measured yet.
- [x] The searchlights' sweep (wall.js update) and the hero's contact shadow (0159); the parked cars already had theirs.

Done so far:
- The stage exported from the web's builders, with the real canvas textures. One web change: `scene.js` exports
  `COURSE_BUILDERS`.
- The renderer: HDR, MSAA 4× memoryless, a shadow map, the course's lights, AgX, the effects, alpha maps, MetalFX,
  the governor.
- The Swift sim's replay drives the car and the row.
- Attribution tools: `-gpu-skip`, `-scale`, the thermal state in the BENCH line.
- Dedicated simulators (`make sims`: "ColdGas Duo", "ColdGas Pro Max"), because another project on this Mac drives the
  stock "iPhone Duo". On that unfolded simulator the real `reservedRegions` API reported the fold at x 455.5, 40 wide,
  exactly 18-0's measurement, and the layout split around it.

## Test plan
`-bench` lines on the phone recorded in the PR; `make shots`; the layout and mesh tests stay green.

## Out of scope
Input, HUD, audio (phase 3). Free Drive (v2).
