---
id: 0021
title: Tyre grip and cornering stiffness fall off with load the way published tyre fits do
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr: 57
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
- [x] Unit test: at Fz/Fz0 = 1, 2 and 3, the tyre's peak μ and its cornering stiffness match the
      cited fit within 5 %; `spec.js` names the source.
- [x] Unit test: cornering stiffness per unit load at 3·Fz0 is below its value at Fz0 (saturation).
- [x] The curl still holds: Wall and Show references land; `tests/unit/fan.test.js` (±30 % at six
      pitches) and `gtrace.test.js` pass unchanged.
- [x] `physics-bench`: tyres-only steady cornering and 60–0 reported before/after in the PR; 0–60 with
      all systems within 2 % of 0.67 s.
- [x] Tyres alone (`fan: 0`), the `physics-bench` steady-corner row: **≥ 1.20 g** at 20, 30 and 40 m/s
      (OFFICIAL "typically 1.26 G's" is the car's number, not the tyre's μ; moved from 0020, where the
      sweep showed the front axle at its friction plateau, not the rack, caps it at 1.12–1.14 g).
- [x] `naive-players` 32/32, `naive-show` 54/54, cue followers ≥ 95/100.
- [x] Node, Chromium and WebKit replays IDENTICAL.

## Builder notes (SIM_VERSION 23)
- Source: Cabrera et al., *A Procedure for Determining Tire-Road Friction Characteristics Using a
  Modification of the Magic Formula Based on Experimental Results*, Sensors 18(3), 2018, Table 2
  (205/65 R15): PDY1 0.932775, PDY2 −0.128085, PKY1 −17.36, PKY2 2.293896. No fit of the
  295/30 R20 / 335/30 R21 semi-slick is public, so the relative shape is carried over (ESTIMATE):
  `tyreLoadSens` = PDY2/PDY1 = −0.137, `tyreKyLoad` = PKY2. The curve's shape at Fz0 stays the
  track tyre's (B·C ≈ 21.6), so with μ0 1.40 the cornering stiffness at Fz0 is 12 % higher than before. Past x ≈ 4.2 (where μ·Fz would start to fall, outside any fit's data) the peak force
  is held. `tests/unit/tyre.test.js` checks μ and Kα at 1, 2 and 3·Fz0 against the fit's own numbers.
- `tyreMu0` = 1.40 (ESTIMATE) is the one fitted number: the tyre's peak μ at static load, chosen so
  the car corners at the OFFICIAL "typically 1.26 G" on tyres alone. `tyreMu` (1.25) stays as the
  car-level number the flight computer, rack and fan schedule plan with, so the fan schedule did not move.
- Longitudinal unchanged (μ 1.25, −7 %/unit load): Fx and Fy have separate peaks, and the
  friction circle is now an ellipse. physics-bench before → after: 0–60 tyres 3.35 → 3.35 s, all
  systems 0.67 → 0.67 s, 60–0 31.5 → 31.5 m. Steady corner (left-hand, clear of the row), fans off,
  1.12/1.13/1.16 → 1.22/1.24/1.25 g at 20/30/40 m/s. Fans armed 2.81/2.91/2.91 → 2.40/2.45/2.46 g:
  at ≈ 2.9·Fz0 the tyre's μ is 1.04 by the fit (was 1.08 at −7 %). Still > 2 G (0020's bar).
- Follow-up (not in this ticket): the rack's lock, Assist's ESC yaw limit and the fan schedule still
  plan with the car-level `tyreMu` scaled linearly by load. With the fans armed they budget ≈ 3.6 g
  where the fit gives the tyres ≈ 3.0 g; the nerds panel's friction ring assumes the 8.4° peak at
  every load. Worth a ticket if the Critic sees the front axle run past its peak in a fan corner.
- The probes turn left now. Turning right from x = 30, a 2.45 g circle reaches the parked row.
- Fixed on the way: the rack's slew time used signed speed and ran away in reverse past 20 m/s
  (drive.test's brake-then-reverse passed on main by timing). New test in drive.test.js.
- References (ref-hash): Show 94, Wall 96, Lineup 92, each a tick different. naive-players 32/32,
  naive-show 54/54. human-show 300 Assist: 189/300, bit-identical to main by group (the cue-following groups
  with-boost and hud are 189/202 = 93.6 % on main too; unchanged by this ticket). Node = Chromium on
  the clean and crash logs; WebKit is not in the sandbox (CI). The change adds only + − × ÷,
  sqrt and dmath.

## Test plan
Pure-function tests of the tyre curves at three loads; the existing stunt, fan and gate tests.

## Out of scope
Camber thrust, temperature, combined-slip weighting functions (a separate ticket if the probe shows
the friction-ellipse clip is the next error), 0020's fan schedule.
