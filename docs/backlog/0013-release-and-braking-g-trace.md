---
id: 0013
title: Release falls free and the brake peaks late, like the livestream G-FORCE trace
status: shipped
priority: P0
size: M
lens: authenticity
created: 2026-10-20
pr: 38
by: critic
---

## Why
The reveal's run 2 (docs/REVEAL_RESEARCH.md §2.1.4, TELEMETRY at 2 Hz) has a G trace that tells
the whole story of a cold-gas landing: **0.2 G at release, 0.3–0.4 G for the first ≈1 s** (the
car falls almost free while side jets roll it), then **1.7 G → 3.3 G peak at ≈6.5 m (21.4 ft)**,
then 1.0, 0.3, a 1.4 G flare, and 1.1 G at touchdown 4.5 s after release.

Ours, measured on the reference Wall and Show runs (0.25 s averages of specific force; method and
raw table in docs/critique/2026-10-20-2140.md):
- **Release is a shove, not a fall.** Wall 2.38 G and Show 2.89 G in the first 0.25 s. Inverted,
  every down-jet the roll-out opens pushes the car toward the ground. The Wall reference falls at
  7.2 m/s after 0.25 s; free fall would give ≈2 m/s.
- **The brake is a long 2 G burn, not a late 3.3 G peak.** Wall: 1.7–2.2 G from 42 ft to 3 ft;
  the 0.25 s-averaged peak is 2.2 G at ≈5 ft. Show: 2.3 G peak at 20–28 ft.
- **The results chip lies about it.** The Show results sheet shows "3.5 g peak" (production
  screenshot, desktop `9-results`), but that peak is the release kick at 27.7 m (`run.t.maxG`
  takes the max of any tick), not the braking. A player reads it as matching the reveal's 3.3 G.

## What
- `src/sim/vehicle.js` flight computer / mixer: while inverted (up·y < 0), LAND rolls out on
  differential thrust that nets ≈ zero force toward the ground (pair a side's down-jets with the
  yaw jets, or cap the inverted lift share), so the first second off the lip is near free fall.
- The LAND governor (`governor`, `brakePlan`): brake late and hard to a peak of 2.8–3.6 G below
  10 m, as the reveal did. If 20 kN nozzles can't reach it pitch-free at 2,447 kg, use the
  research's sourced lever (§11.5: front 23 kN / rear 16 kN, or say why not) rather than
  spreading the burn.
- `src/sim/run.js` telemetry: report `brakePeakG` (max of the 0.5 s-averaged specific force
  while the down-jets brake and the car is upright) separately from `maxG`, and put the braking
  number on the results chip.
- SIM_VERSION bump, CHANGELOG.

## Acceptance criteria
- [ ] Wall and Show references: mean specific force over the first 1.0 s after release ≤ 0.6 G
      (telemetry 0.2–0.4 G).
- [ ] Wall reference: the 0.5 s-averaged specific-force peak during braking is 2.8–3.6 G and
      happens below 10 m altitude (telemetry 3.3 G at 6.5 m).
- [ ] Wall reference: release to touchdown 4.0–5.0 s (telemetry 4.5 s); touchdown sink ≤ 1.5 m/s.
- [ ] Results chip "g peak" shows the braking peak; a unit test asserts it is not the release
      tick.
- [ ] `node scripts/naive-players.mjs` 32/32; `naive-show` ≥ 51/54 over the row;
      `human-show.mjs 300 assist --cues=new` ≥ 95 % for cue followers.
- [ ] Works at 390×844 touch and 1280×720 keyboard; no frame-time regression.

## Test plan
A reveal-fidelity unit test that flies the Wall reference and checks the G trace against the
telemetry bands above (release window, peak value and altitude, release→touchdown time), plus
a telemetry test for `brakePeakG`. Replay fixtures regenerated.

## Out of scope
Lip height (27.7 m is the operator's choice, see the critique) and Pro/Advanced, where the
pilot owns the valves.
