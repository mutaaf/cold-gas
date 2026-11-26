---
id: 0361
title: A wrecked car shuts its valves; no jet fires from a car lying on its roof
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-11-23
pr:
by: critic
---

## Why
The crash is the punchline (Wreck Club), and right now it shows something fake. Production `ac3dca4`, 1440×900, the
Show: the reference to the first air tick, then Pro with nothing held. Sim and director were stepped together at 1/60 s
(`docs/critique/2026-11-23-0400/wreck-page.mjs.txt`).
- The car comes down upside down on the row (body-up · world-up −0.96 to −0.99). The damage sensor reads **66 %** at the
  first hit, and the HUD says **07 WRECKED**.
- For the next **1.22 s** the flight computer keeps firing the nozzles. **74 of 157** frames after the first hit have a
  nozzle above 5 %, and one peaks at **0.97**.
- It vents **36 kg (≈ 80 lb) of nitrogen** while wrecked: `car.air` goes from 289 kg at the first hit to 252.7 kg at
  `done`.
- Screenshots: `desk-pro-wreck-dt0.5-jets.png` and `desk-pro-wreck-dt1.0-jets.png` show three white cones blasting
  from an inverted car on its roof beside a crushed Crossover. `desk-pro-wreck-impact.png` shows four.

The game's own crash model says this can't happen. `src/sim/run.js:409-418` (the aftermath, 0062) says a crash fires
the EV's pyrotechnic HV disconnect, and that the valves are normally-closed solenoids that "fail shut" with no
controller. But the aftermath only starts at `done`, 1.2 s after the crash, so until then a dead car flies its jets.
An airbag controller decides on a crash in tens of milliseconds (ESTIMATE, ≈ 30 ms), and the reveal's engineers would
not let ≈ 9,000 psi of nitrogen (the HUD reads 9.0k psi at +0.5 s) keep firing from a wreck beside the crowd line.

## What
- In `src/sim/vehicle.js` / `run.js`, latch a crash sensor on the run. Close every valve (throttles to 0, no gas used)
  within 8 ticks (≈ 33 ms) of it firing, and keep them closed to the end of the aftermath.
- The trigger, at the latest, is the tick `run.damage.total` first reaches `WRECK_PCT`, which is when the HUD says
  WRECKED. The builder may choose an earlier, physical trigger (a hull hit above a closing speed) and must say why.
- The plumes then follow from the throttles (`plumes.js` reads the same state). Draw no cone and spawn no new mist after
  the latch. Mist already in the air may drift and fade.
- Bump `SIM_VERSION` / `SURFACE_VERSION` if any recorded outcome changes (a wreck's `airEnd`, the Wreck score's inputs),
  add a CHANGELOG note, and regenerate the vectors in the same PR.

## Acceptance criteria
- [x] Unit (`tests/unit/`): the Show reference to the first air tick, then a zero Pro input. From 8 ticks after
      `run.damage.total` first reaches 60, every `car.throttles[i]` is 0 at every tick to the aftermath's end. `car.air`
      is constant over the same span.
- [x] Today's probe (`wreck-page.mjs.txt`) on the PR's preview: "frames with a nozzle > 5 % after the wreck" is 0
      (today 74). A screenshot at +0.5 s after the first hit shows no plume cone.
- [x] Landed runs are untouched: the three references are bit-identical (`node scripts/ref-hash.mjs`), with
      `naive-players` 32/32 and `naive-show` 54/54.
- [x] A crash that is not a wreck (damage < 60, e.g. Rough landing) keeps its jets as today.
- [x] Works at 390×844 touch and 1280×720.

## Test plan
A new unit test drives the deliberate crash above and asserts the throttles and the gas. The existing aftermath tests
stay green.

## Out of scope
The HUD's landing predictor still shows "SINK · LIMIT · BRAKE" for ≈ 0.5 s under the WRECKED label (critique
observation). The reference ghost drawn over the wreck.

## Shipped
- The trigger is the HUD's own: the tick `run.damage.total` first reaches `WRECK_PCT` (now exported from damage.js, re-exported
  by judge.js). A physical trigger (a hull hit above a closing speed) would fire on hits the HUD never calls a wreck, and
  the crash would show WRECKED with jets still live, or shut a car's jets while the HUD reads "Damaged". The valves are shut
  from the next tick (≤ 1 tick, well inside 8): `car.valvesShut` snaps every throttle to 0 (vehicle.js / Vehicle.swift), so
  the plumes draw no cone and spawn no mist.
- WRECK_VERSION 35 on every course (run.js `simVersionOf`); a run carries its version (`run.v`, `run.crashSensor`), so a
  v34 Show/Wall or v33/v32 Lineup run replays as flown and stays replayable. ref-hash bit-identical (show 6b2cb98b,
  wall f1b9fab, lineup 4fc4af6b); naive-players 32/32, naive-show 54/54.
- Node: the critic's wreck (reference to first air, then zero Pro) fired a nozzle > 5 % on 254 of 620 ticks after the wreck and
  vented 30 kg; now 0 and 0. Page (local build, the critic's wreck-page probe): 0 frames with a nozzle > 5 % after the wreck
  (production 74), gas 289.1 kg constant, at 1440×900 and 390×844 touch; +0.5 s shows no cone.
- Physics that follows: `splash-show-wide` wrecks on the row before the tank and falls in at 20 km/h (was driven in at
  31 km/h); a Pro full-throttle slide up the Wall wrecks and slides out instead of being rolled onto its roof by its jets;
  a 120 km/h keys Lineup run that hits the row before it is airborne is coached "You never got off the ground".
