---
id: 0015
title: Tyres build side force over a relaxation length, not instantly
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr: 40
by: scout
---

## Why
Focus priority 1 (tyre behaviour at the limit). A real tyre's lateral force lags slip angle by
the relaxation length, roughly 0.2–0.5 m of rolling (Pacejka, *Tyre and Vehicle Dynamics*, ch. 7,
"transient behaviour"; reference summary https://en.wikipedia.org/wiki/Tire_model#Transient_response).
The sim uses Pacejka steady-state slip (`vehicle.js` ~line 460), so steering and landing
side-loads respond with no lag at any speed. It is why a touchdown with some sideslip feels
snappier than a real fan-car's, and why low-speed manoeuvres cannot oscillate. Relaxation length
for a 295/30 R20 / 335/30 R21 low-profile tyre is an ESTIMATE (≈0.35 m front, 0.4 m rear, scaled by
sqrt(load)); say so in `spec.js`.

## What
- `src/sim/vehicle.js`: per tyre, a first-order lag on slip angle (and slip ratio) with
  time constant `σ / max(|v_x|, v_min)`; state lives in preallocated arrays (no per-frame allocs).
- `src/sim/spec.js`: `tyreRelaxation` front/rear, tagged ESTIMATE with the source above.
- Bump `SIM_VERSION`, CHANGELOG, regenerate replay fixtures.

## Acceptance criteria
- [ ] A step steer at 20 m/s reaches 63 % of steady lateral force after σ metres of travel (±15 %).
- [ ] At v → 0 the lag does not blow up (v_min clamp); a parked car stays parked.
- [ ] `physics-bench` 0–60, braking and cornering within 2 % of today's; `naive-players` 32/32;
      `human-show.mjs 300 assist --cues=new` ≥ 95 %.
- [ ] Node, Chromium and WebKit replays print IDENTICAL.

## Test plan
Unit test for the step response and the low-speed clamp; determinism script; existing gates.

## Shipped notes (PR #40)
- Lateral relaxation only. The slip ratio is not lagged: κ feeds the implicit wheel-spin solve
  (vehicle.js), which keeps wheel spin stable at any speed, and a lag inside that solve risks
  exactly that. A tyre's longitudinal relaxation length is also much shorter than its lateral
  one. If it's wanted, it's its own ticket.
- At a crawl the first-order model goes under-damped (Pacejka ch. 7 adds a low-speed correction).
  The force fades back to the kinematic slip angle between 4.5 and 1.5 m/s. Above that, a shove
  sideways swings back past zero (≤ 0.35 m/s at 6 m/s, from 1 m/s) and settles in 0.5 s.

## Out of scope
Turn-slip, camber thrust, tyre temperature.
