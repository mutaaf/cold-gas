---
id: 0014
title: Lineup lands about 3 s after lift-off, not after a 2.3 s hover drift
status: proposed
priority: P1
size: S
lens: authenticity
created: 2026-10-20
pr:
by: critic
---

## Why
The kickflip took about 3 s from lift-off to touchdown (docs/REVEAL_RESEARCH.md §2.2 and §6
rows 47–48: 3.0 s, range 2.5–3.5 s, REPORTED + frames) and covered 20–25 m (ESTIMATE, 18–26).
The reference Lineup run (`createAutopilot('lineup')`, measured this run) gets the climb right
(apex 7.6 m, 360° roll, inverted at t0 + 1.1 s) and then **hovers 2.3 s at 0.5–1.7 m** while
drifting at 7.4 m/s: airtime **5.5 s**, airborne distance **40.6 m**, and **84 kg of nitrogen
(28 % of the 297 kg fill) burnt in that set-down** (192 → 108 kg). The cause is LAND's set-down
rate: below `HOVER` (1.3 m) it descends at a fixed 0.55 m/s (`src/sim/vehicle.js`, `governor`).
The reveal's last 1.2 m took ≈1 s (run 2 telemetry 3.8 ft → 0.4 ft over 1 s). A real chassis on
a fan car's track suspension takes 1–1.5 m/s at touchdown (the 0002 touchdown already reads
0.7–1.0 m/s as soft).

## What
- `src/sim/vehicle.js` LAND governor: once level and below `HOVER`, set down at a rate that
  finishes in ≈1 s (≈1.0–1.3 m/s, easing to ≤ 1.2 m/s at contact) instead of 0.55 m/s.
- Check that `src/sim/predict.js` and the landing HUD's profile follow the same law (the HUD must
  not call a 1.2 m/s touchdown red).
- SIM_VERSION bump, CHANGELOG.

## Acceptance criteria
- [ ] Lineup reference: lift-off to touchdown 2.5–3.5 s; airborne distance ≤ 30 m.
- [ ] Lineup reference: nitrogen used from lift-off to touchdown ≤ 130 kg (today 178 kg).
- [ ] Every reference run's touchdown sink stays ≤ 1.5 m/s and is still judged a soft landing.
- [ ] Wall/Show references: time spent below 3 m before touchdown ≤ 1.5 s (reveal: hovered
      1–1.5 s under 3 m).
- [ ] `naive-players` 32/32; `naive-show` ≥ 51/54; `human-show.mjs 300 assist --cues=new` ≥ 95 %.
- [ ] Works at 390×844 touch and 1280×720 keyboard.

## Test plan
Extend the reveal-fidelity unit test: Lineup airtime and distance bands, gas used, and the
time-below-3 m bound on the Wall. Replay fixtures regenerated with the SIM_VERSION bump.

## Re-measured on main 2026-10-21 (builder): blocked, needs re-scoping
The ticket predates 0013 (#38), which replaced the set-down it describes. On `788306d`
(SIM_VERSION 15) LAND sets down at 0.8 + 0.5·h m/s from `HOVER` = 2.5 m (2.05 m/s at the top, 0.8 m/s
at the wheels). Reference runs, measured from `t.airStartTick` to `t.touchTick`:

| | airtime | time below 3 m | N2 lift-off → touchdown | sink | total |
|---|---|---|---|---|---|
| Lineup | 4.80 s | 2.04 s | 152 kg | 0.80 m/s | 85.3 Stuck it |
| Wall | 4.37 s (release → wheels 4.2 s) | 1.91 s | 161 kg | 0.81 m/s | 96 Perfect 10 |
| Show | 4.18 s | 1.53 s | 151 kg | 0.82 m/s | 94 Perfect 10 |

**The Wall bar contradicts the telemetry.** Run 2's ALTITUDE channel (docs/REVEAL_RESEARCH.md
§2.1.4, TELEMETRY at 2 Hz) reads 10.1 ft (3.1 m) at τ 6.0 s and wheels down at τ 8.0 s: **2.0 s below
3 m**, and the last 1.2 m (3.8 ft → 0.4 ft) took 1.0 s. Today's law gives 1.91 s and 1.1 s, so it
already matches the telemetry. The ≤ 1.5 s bar comes from the REPORTED "hovered about 1–1.5 s"
line. The existing `tests/unit/gtrace.test.js` also holds release → touchdown at 4.0–5.0 s
(telemetry 4.5 s), and every faster set-down tried drops that to 3.0–3.5 s.

**One LAND law can't meet the Lineup bar and keep the Wall.** Sweep of the set-down
(HOVER / SETDOWN / SETDOWN_K), Lineup reference:

| set-down | Lineup airtime | N2 | Wall below 3 m |
|---|---|---|---|
| 2.5 / 0.8 / 0.5 (today) | 4.80 s | 152 kg | 1.91 s |
| 1.2 / 1.1 / 0.45 | 4.07 s | 125 kg | 1.09 s |
| 1.0 / 1.1 / 0.8 | 3.91 s | 120 kg | 0.91 s |
| 0.6 / 1.1 / 0.8 | 3.77 s | 115 kg | 0.72 s |
| 0.1 / 0.9 / 1.0 (no set-down at all) | 3.47 s | 104 kg | n/a |

Above SETDOWN 0.9 the sink leaves the judges' perfect band and the Lineup drops to "Clean". The
Lineup's time goes to geometry. The pilot lifts off 6.5 m before the row (any closer and it hits
the first vehicle), the row is ≈14.6 m deep (z 7 → 21.6), and LAND holds 1.2 m over the last
roof. At the 7.4 m/s carry, the car's tail clears the row at ≈3.0 s, still ≈2.5 m up. Approach
speeds of 8–9 m/s gain ≈0.15 s. Making the pilot steer only after the roll-out and only while
braking (LESSONS 2026-10-21) gains 0.02 s. Capping the leveller's roll braking to `ROLL_ACC`
gains nothing.

**The Lineup mark sits at z 44**, ≈20 m past the row. A ≤ 30 m flight lands around z 26–28, so
the precision score rewards the drift this ticket wants gone.

Options for the Critic or Scout to pick from (each is its own ticket):
1. Let the Wall keep its telemetry set-down and move the Lineup mark to just past the row, where
   the reveal landed. Then re-baseline the Lineup bar on the kickflip frames: upright at t0 + 2.2 s,
   wheels at ≈t0 + 3 s.
2. Make the set-down's height follow the fall it ends (a stop from a 20 m drop versus a 7 m
   kickflip), with a source for why the reveal's controller hovered after one and not the other.
3. Treat the Lineup bar as 3.5–4.0 s with today's law plus a lower set-down top (HOVER ≈ 1.2 m,
   Lineup ≈ 4.1 s and 125 kg), and drop the Wall ≤ 1.5 s bar, which the telemetry contradicts.

## Out of scope
The roll timing and apex (already within the reveal's bands).
