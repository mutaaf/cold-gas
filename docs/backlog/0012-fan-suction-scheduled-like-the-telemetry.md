---
id: 0012
title: Schedule fan suction the way the livestream DOWNFORCE channel shows, not pinned at max
status: ready
priority: P0
size: M
lens: authenticity
created: 2026-10-20
pr:
by: critic
---

## Why
The reveal's on-screen DOWNFORCE channel (docs/REVEAL_RESEARCH.md §2.1.2, TELEMETRY, frame-read
at 1 Hz) climbs with pitch: 79 kgf at rest with fans spooling, 186 at 1.5°, 434 at 25°, 825 at
50°, 1,544 at 75°, 3,220–3,412 at 90°, 4,510 at 127°, 4,700 at 170°, and it falls again as the
car reverses down. The controller asked for the suction the attitude needed, plus a margin.
The sim does none of that. `src/sim/vehicle.js:364-367` sets fan force = command × 46 kN, and the
reference Wall run reads **4,687–4,689 kgf from the first metre of the curl at 7° pitch** (the
scratch measurement in docs/critique/2026-10-20-2140.md § Measurements). On the flat entry that is
2.9 g of extra normal load through the tyres. Spool is `fanSpool: 0.4` s (`src/sim/spec.js`),
against the research's 1.5 s to 90 % (§6 row 21, REPORTED telemetry: 79 → 434 kgf over 3 s). So
the number the engineers put on screen, which is the fan system's whole story, is not in the
game, and the tyres run at the wrong load all the way up the wall.

## What
- `src/sim/vehicle.js` (fan block): with the fan armed, command suction from the attitude and
  the surface: enough normal force to hold the car on the deck with friction margin (gravity's
  component off the surface plus the centripetal need on the arc, divided by μ, times a safety
  factor), capped at `fanMaxForce`. Use the telemetry table as the calibration target and
  document the law and the margin in `spec.js` (ESTIMATE, with the reasoning).
- `SPEC.fanSpool`: move toward the sourced 1.5 s to 90 % (range 1–3 s). If the Assist cue
  timing depends on the 0.4 s value, adjust the cue, not the number.
- Expose `fanForce` in kgf to the HUD's FAN readout (today it shows the 0–100 % command).
- SIM_VERSION bump, replay fixtures regenerated, CHANGELOG.

## Acceptance criteria
- [ ] Reference Wall run (`createAutopilot('wall')`): fan force in kgf at pitch 25°, 50°, 75°,
      90°, 127°, 170° is within ±30 % of the telemetry row for that pitch (434 / 825 / 1,544 /
      3,300 / 4,510 / 4,700 kgf, research §2.1.2). Unit test asserts it.
- [ ] On level ground with the fan armed and the car stopped, fan force ≤ 250 kgf (telemetry
      79–186 kgf rolling on the pad).
- [ ] Spool: from 0 to 90 % of the commanded force takes 1.0–3.0 s (research §6 row 21).
- [ ] Inverted on the ledge, stationary, the car still holds for ≥ 10 s (run 1 hung ≈10 s).
- [ ] The HUD FAN readout shows kgf, matching `car.fanForce / 9.81` to ±1 %.
- [ ] `node scripts/naive-players.mjs` 32/32; `node scripts/naive-show.mjs` ≥ 51/54 over the row;
      `node scripts/human-show.mjs 300 assist --cues=new` ≥ 95 % for cue followers.
- [ ] Works at 390×844 touch and 1280×720 keyboard; no frame-time regression.

## Test plan
`tests/unit/` reveal-fidelity: fly the Wall reference, sample fan kgf at the six pitches, assert
the bands; a level-ground idle test; a spool-time test; an inverted 10 s hold test. Replay
determinism tests regenerated with the SIM_VERSION bump.

## Out of scope
The skirt gap law (h₀) and the 2 g vs 4,700 kg dispute (research §7.2): keep 46 kN as the cap.
