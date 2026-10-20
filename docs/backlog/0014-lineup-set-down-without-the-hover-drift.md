---
id: 0014
title: Lineup lands about 3 s after lift-off, not after a 2.3 s hover drift
status: ready
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

## Out of scope
The roll timing and apex (already within the reveal's bands).
