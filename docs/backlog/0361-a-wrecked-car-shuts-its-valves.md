---
id: 0361
title: A wrecked car shuts its valves; no jet fires from a car lying on its roof
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-11-23
pr:
by: critic
---

## Why

SCOUT 2026-11-26: held at proposed to keep the ready queue at its cap of 10; the funnel (21 landings, 0 posts, 0 shares) puts 0364/0365/0366 first. Promote when room.
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
- [ ] Unit (`tests/unit/`): the Show reference to the first air tick, then a zero Pro input. From 8 ticks after
      `run.damage.total` first reaches 60, every `car.throttles[i]` is 0 at every tick to the aftermath's end. `car.air`
      is constant over the same span.
- [ ] Today's probe (`wreck-page.mjs.txt`) on the PR's preview: "frames with a nozzle > 5 % after the wreck" is 0
      (today 74). A screenshot at +0.5 s after the first hit shows no plume cone.
- [ ] Landed runs are untouched: the three references are bit-identical (`node scripts/ref-hash.mjs`), with
      `naive-players` 32/32 and `naive-show` 54/54.
- [ ] A crash that is not a wreck (damage < 60, e.g. Rough landing) keeps its jets as today.
- [ ] Works at 390×844 touch and 1280×720.

## Test plan
A new unit test drives the deliberate crash above and asserts the throttles and the gas. The existing aftermath tests
stay green.

## Out of scope
The HUD's landing predictor still shows "SINK · LIMIT · BRAKE" for ≈ 0.5 s under the WRECKED label (critique
observation). The reference ghost drawn over the wreck.
