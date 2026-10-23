---
id: 0027
title: The passenger-seat tank moves the CoM 6 cm toward it, and the jets trim for it as it empties
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
Focus priority 2 (nitrogen system truth). The Rocket's second COPV is a 400 L cylinder "in the
passenger seat" (docs/REVEAL_RESEARCH.md §5.1, OFFICIAL). The §11.4 mass build-up puts the CoM
**6–7 cm toward the tank side** with the gas full, because about 480 kg sits 0.38 m off the
centreline against an 80 kg driver on the other side. "As the gas empties, the CoM drifts … back
toward the centreline." §11.6 recommends **0.06 m toward the right (range 0.03–0.09), ESTIMATE**.
The same arithmetic with the 198 kg of seat-tank gas gone ((282 − 80)·0.38 / 2,270) gives
≈ **0.034 m** empty. `src/sim/spec.js` has no lateral CoM (`comFromFront` and `comHeight` only), so
the car is perfectly symmetric.

This is a real consideration, not a detail:
- With LIFT on all four down-jets (±0.75 m, 66.5 kN pitch-free), a 0.06 m offset is ≈ **4 kN·m of
  roll**, or ≈ 6.5 rad/s² at Ixx 615 kg·m² (§11.6). The flight computer has to trim it, as it already
  trims pitch (`TRIM`, `vehicle.js:82`; LESSONS "where a jet sits is how it flies"), and the trim
  costs lift. Today it costs nothing.
- On the tyres, the tank-side wheels carry ≈ 53.5 % of the weight (0.5 + 0.06/1.72 m track). The car
  turns in one way slightly harder than the other, as a real asymmetric car does.
- The trim changes during the flight, because the offset shrinks as the gas goes.

## What
- `src/sim/spec.js`: `comLateral` 0.06 m toward the tank side at full gas, 0.034 m empty, linear in
  gas mass (ESTIMATE, §11.4/§11.6, with the arithmetic in the comment). Body +x is the car's LEFT
  (LESSONS), so the CoM sits at −x if the tank is on the right. State the side and keep it
  consistent with the renderer's tank.
- `src/sim/vehicle.js`: nozzle and wheel positions relative to the moving CoM (or apply the offset's
  moment directly). The mixer's lift trim cancels the roll moment from the current offset, so LIFT
  stays roll-free, and `LIFT_MAX` / the brake plan / `predict.js` use the trimmed lift.
- SIM_VERSION bump, CHANGELOG, replay fixtures.

## Acceptance criteria
- [ ] Unit: at rest on the level, right-minus-left static wheel load is m·g·comLateral/(track/2)
      within 10 % at full gas, and smaller by the empty/full ratio (0.034/0.06) with the tanks empty.
- [ ] Unit: a full LIFT chord in free flight (Advanced valves through the mixer, Assist off) gives
      |roll acceleration| ≤ 0.2 rad/s² at full and at empty gas. With the trim disabled it is
      5–8 rad/s² at full gas (so the test proves the offset is there).
- [ ] Pitch-free, roll-free lift at full gas drops by the trim's cost (report the kN). The Wall
      reference's braking peak stays 2.8–3.6 G (`tests/unit/gtrace.test.js` unchanged and green).
- [ ] References still land: Wall, Show, Lineup sink ≤ 1.5 m/s, each within ±3 of today's total
      (96.3 / 94 / 92).
- [ ] `node scripts/physics-bench.mjs` gains a left-versus-right steady corner at 25 m/s. The two
      lateral-g figures differ by > 0 and < 5 %.
- [ ] `naive-players` 32/32; `naive-show` ≥ 51/54; `human-show.mjs 300 assist --cues=new` cue
      followers ≥ 95 %; determinism IDENTICAL.

## Test plan
Add `tests/unit/com-lateral.test.js` with the wheel-load split and the LIFT-chord roll acceleration
(trim on/off, full/empty). Regenerate the replay fixtures with the SIM_VERSION bump.

## Out of scope
The fore-aft CoM drift as gas empties (≈ 0.02 m, §11.4; a follow-up if this lands cleanly),
gas sloshing (it's a gas), and the renderer's interior.
