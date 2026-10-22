---
id: 0032
title: Tyre grip depends on temperature: a cold night costs a little, a burnout buys it back
status: proposed
priority: P2
size: M
lens: authenticity
created: 2026-10-22
pr:
by: scout
---

## Why
Focus priority 1 (tyre behaviour at the limit). The pad stands under blue-hour air near the evening
low and the run-up is ~4 s. A road tyre's grip is a bell curve in carcass/tread temperature: noticeably
lower when cold, peaking in a window, then falling again (Pacejka, *Tyre and Vehicle Dynamics*, thermal
tyre models; Milliken & Milliken, *Race Car Vehicle Dynamics*, tyre temperature chapters). `tyre`
constants in `spec.js` assume one fixed μ. A lumped one-state thermal model (heat from slip power
`Fx·vx_slip + Fy·vy_slip`, cooling to ambient with a time constant) gives the first run-up a slightly
softer grip than a warmed repeat, and makes wheelspin and Retry-without-driving honest. This is the
lowest-priority realism item: keep the effect small (a few percent μ) unless a sourced figure says
otherwise, and tag every number ESTIMATE.

## What
- `src/sim/spec.js`: `tyreTempAmbient`, `tyreTempPeak`, `tyreHeatCap`, `tyreCoolTau`, `muTempWidth` (ESTIMATE).
- `src/sim/vehicle.js`: per-tyre temperature state `s.tyreT[4]` (fixed typed array), heated by slip power,
  cooled toward ambient; scale peak μ by a smooth bell in T.
- Start-of-run temperature is deterministic (ambient + fixed warm-up the car had on the way to the
  foot of the Wall), so replays and the Worker verification agree.
- For nerds panel: tyre temperatures (display only). `SIM_VERSION` bump, CHANGELOG row.

## Acceptance criteria
- [ ] Peak μ at ambient is 0.93–0.98 of peak μ at the optimum window (unit test of the bell).
- [ ] Temperature stays bounded (no growth beyond physical range) over 60 s of sustained slip, and is
      allocation-free per tick.
- [ ] `physics-bench.mjs` 0–60 / braking / cornering within tolerance; `naive-players.mjs` 32/32;
      `human-show.mjs 300 assist --cues=new` ≥ 95 %; determinism IDENTICAL.

## Test plan
Unit tests for the heat balance (steady state vs closed form) and the μ bell; replay test re-baselined.

## Out of scope
Wear, pressure change with temperature, rain.
