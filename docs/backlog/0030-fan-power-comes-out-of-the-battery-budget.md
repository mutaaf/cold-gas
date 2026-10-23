---
id: 0030
title: The suction fans draw their ~80 kW from the same 1 MW the motors use
status: proposed
priority: P1
size: S
lens: authenticity
created: 2026-10-22
pr:
by: scout
---

## Why
Focus priority 2/1 (honest systems). docs/REVEAL_RESEARCH.md §4 (OFFICIAL, Moravy via MotorTrend and
Hagerty): each of the four fans is a heat-pump compressor motor spun past 15,000 rpm at about 20 kW,
**about 80 kW total**. `spec.js` has the 1.0 MW powertrain (`power: 1_000_000`) and a fan force model,
but nothing in `src/sim/` charges the fans' electrical draw against the drive budget (grep `fanPower`
finds nothing). With the fans armed at full suction the real car has ~8 % less power for the
wheels, and the on-screen power/energy story is a little too generous in the 0–60 and the Wall climb.
Small, sourced, and it makes "the fans are not free" true.

## What
- `src/sim/spec.js`: `fanPowerMax: 80_000` W (OFFICIAL, §4), tagged with the source.
- `src/sim/vehicle.js`: motor power available = `SPEC.power − fanPowerMax·(fan duty)³` (power ∝ speed³
  for a fan, ESTIMATE from the affinity laws; say so in a comment), applied where the drive force is
  capped by power.
- `src/hud-telemetry.js` / For nerds: show fan electrical kW beside FAN force (display only).
- `SIM_VERSION` bump, CHANGELOG row.

## Acceptance criteria
- [ ] At full suction and full throttle the available drive power is 920 kW ± 1 %; with the fans idle
      it is 1,000 kW (unit test on the power cap).
- [ ] `node scripts/physics-bench.mjs` 0–60 stays within the bench's existing tolerance of the
      official figure (fans are near idle on the pad), and the numbers in the PR body show before/after.
- [ ] Wall and Show references still land; `naive-players.mjs` 32/32; `human-show.mjs 300 assist
      --cues=new` ≥ 95 %; `npm run determinism` IDENTICAL.
- [ ] Works at 390x844 touch and 1280x720 keyboard (readout fits, `hud-audit.mjs` clean).

## Test plan
Unit test in `tests/unit/` for the power cap vs fan duty; re-run the replay and determinism tests
(SIM_VERSION bump); physics-bench before/after in the PR.

## Out of scope
Battery sag, thermal derating, regen; a fan-noise change.
