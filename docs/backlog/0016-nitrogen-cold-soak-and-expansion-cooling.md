---
id: 0016
title: Nitrogen cools as it expands — thrust and Isp fall with gas temperature
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: scout
---

## Why
Focus priority 2 (nitrogen system truth). Cold-gas thrust goes as chamber pressure and
sqrt(T): Isp ∝ sqrt(γRT/(γ−1))-ish for a given expansion, so a tank that blows down adiabatically
cools and loses Isp as well as pressure (NASA cold-gas thruster notes, e.g.
https://ntrs.nasa.gov/ search "cold gas propulsion"; Sutton & Biblarz, *Rocket Propulsion
Elements*, ch. 2 and 7). research §9 item 4 already records that adiabatic vs isothermal changes
total impulse by ≈40 %. `vehicle.js` ~556 uses `isp = ispFull·(0.7+0.3·pr)`, a fit with no
temperature state, so a long brake after a long hang costs the same gas as a short one.

## What
- `src/sim/vehicle.js`: a tank-gas temperature state, `T = T0·(m/m0)^(γ−1)` for adiabatic blowdown
  (γ = 1.4) with slow re-warming toward ambient (tank wall conduction, ESTIMATE time constant
  ~60 s so within a 10 s flight it is nearly adiabatic). Isp and mass flow scale with sqrt(T/T0).
  Replace the ad-hoc `0.7+0.3·pr` term, keeping the end-of-flight thrust within 5 % of today's
  so the references still land.
- `src/sim/spec.js`: `tankTemp0` (ambient, 288 K), `gamma`, tagged; ESTIMATE where unsourced.
- HUD: optional gas temperature in the N₂ readout tooltip/inspect only (no new HUD clutter).
- SIM_VERSION bump, CHANGELOG, fixtures.

## Acceptance criteria
- [ ] After 40 % of the gas is spent, tank T is ≈ 0.88·T0 and nozzle Isp is ≈ 6 % lower (unit-tested
      against the closed form).
- [ ] Wall and Show references still land (sink ≤ 1.5 m/s); end-of-brake thrust within 5 % of before.
- [ ] A 30 s cold-soak start (re-warm) restores T within 2 K.
- [ ] `naive-players` 32/32; `human-show.mjs 300 assist --cues=new` ≥ 95 %; determinism IDENTICAL.

## Critic note 2026-10-21 (by the Critic, measured on main 4d00ca0)
- **The closed form in the first criterion is off.** Adiabatic T = T0·(m/m0)^(γ−1): with 60 % of
  the gas left that is 0.6^0.4 = **0.815·T0**, not 0.88, and Isp ∝ √T falls ≈ **10 %**, not 6 %.
- **"End-of-brake thrust within 5 % of today's" would lock in the error this ticket exists to fix.**
  Integrating today's law (`pressureOf` with the 0.55 regulator, `isp = 72·(0.7 + 0.3·pr)`) for a
  full dump through the four down-jets gives **186 kN·s total impulse at a 64 s average Isp**, and
  thrust stays above half for 1.83 s of continuous firing. docs/REVEAL_RESEARCH.md §5.2 (ESTIMATE,
  CoolProp real-gas blowdown, Rocket 600 L at 80 kN) gives **140 kN·s and 52 s adiabatic** (the
  realistic case for a fast dump), 192–195 kN·s only if the tank stayed isothermal, and F = 50 % at
  0.65 s adiabatic. So the game flies the isothermal tank this ticket says it isn't.
  Replace that criterion with: a full dump through the down-jets yields **140–160 kN·s** (adiabatic,
  with a little wall heat) and an average Isp of 50–58 s, and the references still land (Wall
  nitrogen used rises from 165 kg today; it must stay ≤ 270 kg of 297, one fill per stunt).
- Whether the "Thruster 5,500 psi" screen (§5.1, REPORTED) was a regulator set point or the tank
  itself is unsourced; if the regulator stays, say so in `spec.js` as an ESTIMATE with that reasoning.

## Test plan
Unit test of the blowdown closed form and re-warm; reference-flight regression bands.

## Out of scope
Ambient-temperature days (see 0005), condensation / plume rendering.
