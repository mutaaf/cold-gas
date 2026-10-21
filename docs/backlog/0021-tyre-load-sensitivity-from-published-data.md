---
id: 0021
title: Tyre grip and cornering stiffness fall off with load the way published tyre fits do
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
This car's tyres live at loads no road car sees: on the curl the fan puts 3,060–3,430 kgf on the
tyres (critique 2026-10-21-0345), and with full suction on the level the probe in
docs/critique/2026-10-21-0945.md measured 2.9 g of tyre load. How grip and cornering stiffness scale
with load decides the curl's margin, every touchdown's side force, and 0020's corner. Focus item 1
asks for "load sensitivity … checked against published data for the tyre sizes and mass".

Today (`src/sim/vehicle.js:705-707` and `:40-48`):
- **μ falls 7 % per unit of normalised load** (`1 − 0.07·(Fz/Fz0 − 1)`). At 2.9 g that is μ 1.08.
  Magic Formula fits of performance tyres usually carry a larger term (pDy2 on the order of −0.1 to
  −0.2 per unit dfz; ESTIMATE, Pacejka, *Tyre and Vehicle Dynamics*, ch. 4, MF parameter tables). The
  builder must cite the exact table or a published fit for a 295–335 section tyre before choosing.
- **Cornering stiffness grows linearly with load.** `B·C·D` with `D = μFz` gives ≈ 27·Fz per rad at
  every load. Published MF fits saturate it (`K = pKy1·Fz0·sin(2·atan(Fz/(pKy2·Fz0)))`, peak near
  pKy2 ≈ 1.5–2.5 × Fz0; ESTIMATE, same source). At 2.9 g the game's tyre is ~1.5× stiffer than a
  saturating fit would make it.
- There is no source or ESTIMATE note in `spec.js` for either number.

## What
- `src/sim/spec.js`: `tyreLoadSens` (pDy2-like) and a cornering-stiffness saturation pair
  (pKy1, pKy2), each tagged ESTIMATE with the table or paper it comes from.
- `src/sim/vehicle.js`: lateral `B` derived from the saturating stiffness (`B = K/(C·D)`), μ from the
  sourced load term. Longitudinal stays as is unless the same source gives it.
- Re-fit nothing silently: if the fan schedule (0012) or the 0–60 gate moves, say what real quantity
  changed in the PR.
- Bump `SIM_VERSION`; regenerate replay fixtures.

## Acceptance criteria
- [ ] Unit test: at Fz/Fz0 = 1, 2 and 3, the tyre's peak μ and its cornering stiffness match the
      cited fit within 5 %; `spec.js` names the source.
- [ ] Unit test: cornering stiffness per unit load at 3·Fz0 is below its value at Fz0 (saturation).
- [ ] The curl still holds: Wall and Show references land; `tests/unit/fan.test.js` (±30 % at six
      pitches) and `gtrace.test.js` pass unchanged.
- [ ] `physics-bench`: tyres-only steady cornering and 60–0 reported before/after in the PR; 0–60 with
      all systems within 2 % of 0.67 s.
- [ ] `naive-players` 32/32, `naive-show` 54/54, cue followers ≥ 95/100.
- [ ] Node, Chromium and WebKit replays IDENTICAL.

## Test plan
Pure-function tests of the tyre curves at three loads; the existing stunt, fan and gate tests.

## Out of scope
Camber thrust, temperature, combined-slip weighting functions (a separate ticket if the probe shows
the friction-ellipse clip is the next error), 0020's fan schedule.
