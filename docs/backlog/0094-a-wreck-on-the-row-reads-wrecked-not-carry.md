---
id: 0094
title: A car wrecked on top of the row reads WRECKED, not 05 CARRY
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-10-27
pr:
by: critic
---

## Why
0065 (#125) made the timeline honest about braking and labels the crash `07 WRECKED` "while the car is
down". But "down" is `run.phase !== 'air'`, and a car that falls onto the parked row is still `air` to the
sim: it lies on the row's roofs, not on the concrete. So for a full second the HUD says the car is carrying
over the row while it lies on its roof on top of the row.

Measured on the build production serves (`5e1bf19`, local static build, entry `index-D_uW_sNm.js` identical),
390×844 touch, the critic's valves-shut crash: every input zeroed from release + 0.125 s, sampled every 0.05 s
with `liveStep`:

| t after release | `run.phase` | height | sink | hull on something | `[data-dmg]` state | timeline `now` |
|---|---|---|---|---|---|---|
| +1.90 s | air | 5.7 m | 20.9 m/s | no | ok, 0 % | 05 CARRY |
| **+1.95 s** | air | 4.8 m | 16.0 m/s | **yes (the row)** | **wreck, 66 %** | **05 CARRY** |
| +2.25 to +2.95 s | air | 2.1 → 1.2 m | 0.3–3.2 m/s | yes | wreck, 66 % | **05 CARRY** |
| +3.00 s | landed | 1.0 m | 0.9 m/s | yes | wreck, 66 % | 07 WRECKED |

That's 21 consecutive samples (1.05 s) of `05 CARRY` next to `WRECKED 66 %` in red. On production the
compact HUD shows exactly that over the car upside down on the row
(`docs/critique/2026-10-27-0357/phone-C-6-on-the-row.jpg`: `05 CARRY · SINK 56.7 ft/s · WRECKED 66 %`).
The real car's run was "carry" only while it was flying clear (docs/REVEAL_RESEARCH.md §2.1.4: falling clear
from 67.5 ft, braking from 39 ft). A crash into the row is the end of the flight, and the HUD should say so
from the hit, as 0072 and 0065 already decided for a crash on the concrete.

## What
- `src/main.js` `flightPhase`: the wreck label takes over from the first moment the damage panel reads
  wrecked (≥ 60 %, the same threshold 0065 uses) with any bodywork contact (`c.hullContact` or
  `c.obstacleContact`), whatever `run.phase` says. The TOUCHDOWN step shows the crash label (`WRECKED`, then
  0072's end label such as `FLIPPED`). The timeline stays monotonic (0047).
- No sim change.

## Acceptance criteria
- [x] e2e, the valves-shut crash above (Show reference, inputs zeroed from release + 0.125 s), sampled every
      0.05 s: no sample has the timeline's `now` on CARRY, BRAKE or TOUCHDOWN while `[data-dmg]` reads `wreck`
      (today: 21 of 21 wrecked air samples read `05 CARRY`). The first wrecked sample already reads the crash
      label.
- [x] The Show, Wall and Lineup references still run RELEASE → CARRY → BRAKE → TOUCHDOWN with no WRECKED
      (their damage stays below the wreck threshold), and `tests/e2e/timeline.spec.js` stays green.
- [x] A light scrape that does not reach the wreck threshold (e.g. the crash-probe's `rollover` case, if it
      stays under 60 %) does not flip the label.
- [x] Screenshot at 390×844 of the car on the row under the crash label, in the PR.
- [x] hud-audit and title-audit stay clean (lockdown focus).

## Test plan
Extend `tests/e2e/timeline.spec.js`'s `sampleFine(page, true)` (0065's crash sampler) to read
`[data-dmg]`'s `data-state` and assert the criterion above.

## Out of scope
Where the car hits the row, the damage model, the brake height (0028).

## Shipped (2026-10-29, builder)
`flightPhase` (src/main.js) takes the TOUCHDOWN step, which `syncHud` reads as `Wrecked`, from the first frame
the run's damage reaches `WRECK_PCT` in the air: damage is written only by impacts, so a wrecked car has hit
something, and its contact flag may already be off on the frame that draws it. The light-scrape case keys off
the same 60 % threshold the damage panel uses, so anything under it keeps its flight step. On main the new
e2e (`tests/e2e/timeline.spec.js`, 0094) read 21 wrecked samples still `air`, all under `05 Carry`; with the
fix all 32 wrecked samples read `07 Wrecked` (then `07 Flipped`), and the Show reference never shows a crash
label. Shots: `docs/shots/wreck-0094/`.
