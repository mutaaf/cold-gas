---
id: 0031
title: Dampers firmer in rebound than bump, and the tyre is a spring too (landing transient)
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-10-22
pr:
by: scout
---

## Why
Focus priority 3 (landing physics). `vehicle.js` line 30 gives each corner one linear spring and one
symmetric damper (`K_SPRING 150000`, `C_DAMP 9500`, bump stop `BUMP 600000`, 16 cm travel).
Real automotive dampers are asymmetric (rebound force about 1.5–3× bump) and the tyre itself is a
radial spring of its own (a low-profile 21-inch road tyre is typically 200–300 kN/m, in series with the
suspension). Both shape the first 50 ms of a touchdown: how hard the first peak is, and whether the
car rebounds off the pad. The sim's touchdown ring and the "stick the landing" feel depend on
this transient. Sources to cite in the PR: Pacejka, *Tyre and Vehicle Dynamics* (radial stiffness and
damping chapter); Milliken & Milliken, *Race Car Vehicle Dynamics* (damper ratios, rebound/bump).
Tag every number ESTIMATE with its reasoning if no tyre-maker data for the 275/35R21 / 305/30R21-class
sizes in docs/REVEAL_RESEARCH.md §3.5 can be found.
Depends on 0017 (bump stop + spin-up); do that first.

## What
- `src/sim/spec.js`: `damperBump`, `damperRebound`, `tyreRadialK`, `tyreRadialC`, each with source or ESTIMATE note.
- `src/sim/vehicle.js` (~line 798): asymmetric damper (select by sign of `compRate`); tyre radial spring
  in series with the suspension spring (effective stiffness `k_s·k_t/(k_s+k_t)`), keeping static sag
  at ~3 cm.
- `SIM_VERSION` bump, CHANGELOG row.

## Acceptance criteria
- [ ] Rebound/bump ratio is in [1.5, 3] and static sag still 3 cm ± 0.5 cm (unit test).
- [ ] A 2.5 m/s drop onto the pad (test harness) shows a first-peak wheel load and a settling time that
      match the closed-form for the chosen k and c within 10 %, and the car does not leave the ground again.
- [ ] Show reference lands with sink ≤ 1.5 m/s and no new bounce; `naive-players.mjs` 32/32;
      `human-show.mjs 300 assist --cues=new` ≥ 95 %; determinism IDENTICAL.

## Test plan
Unit test for the drop (energy/peak vs closed form), the existing replay tests re-baselined with a SIM_VERSION bump.

## Out of scope
Active ride-height control, anti-roll bars, camber.
