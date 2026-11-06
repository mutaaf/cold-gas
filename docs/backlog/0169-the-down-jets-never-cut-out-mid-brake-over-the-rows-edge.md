---
id: 0169
title: The down-jets never cut out mid-brake as the car passes the row's last roof, on one thumb or in the Lineup
status: ready
priority: P0
size: M
lens: authenticity
created: 2026-11-06
pr:
by: critic
---

## Why
The reveal's landing burn is **one** pulse. It builds from 1.7 G at 12 m to **3.3 G at about 6.5 m**, eases to
1.0 G at 3.1 m and flares to 1.4 G at 1.2 m. The jets never go out between the onset and the wheels
(docs/REVEAL_RESEARCH.md §2.1.4, TELEMETRY at 2 Hz; paultan REPORTED "3.3 G at about 6.5 metres").

The one-thumb Show is the flight most players fly: phones come first (control.json focus), and one thumb is the
default. On that flight the down-jets **switch off completely at 6.5 m, the reveal's peak height**. The car falls
free for 0.23 s and speeds up from 5.8 to 8.0 m/s, then the jets light again for a second 2.8–3.0 g burn at 4.4–3.0 m.
That's a brake, a gap and a brake again, with the plumes going out and back on in the middle of the money shot.
The 2026-11-05 critique called this brake "close to the reveal". A 0.25 s average hid the gap.

Measured on main `bb312d3` (production build `index-YrtIvo3P.js`, same `ref-hash`). The probes are in the
2026-11-06 critique, §1. They used Node, `thumb-mastery.test.js`'s one-thumb harness and per-tick specific force from Δv:

| after release | height | sink | specific force |
|---|---|---|---|
| 1.70–2.20 s | 11.9 → 6.8 m | 14.5 → 6.1 m/s | 2.7–3.0 g (the first burn) |
| **2.25 s** | **6.56 m** | 5.75 m/s | **0.63 g** |
| **2.30–2.45 s** | **6.3 → 5.2 m** | **6.1 → 7.6 m/s** | **0.00–0.11 g (jets off)** |
| 2.50 s | 4.85 m | 8.0 m/s | 0.51 g |
| 2.55–2.85 s | 4.4 → 3.0 m | 7.5 → 2.3 m/s | 2.4–3.0 g (the second burn) |

- **Cause (traced):** in the same tick, LAND's altimeter (`landHeight`, `src/sim/vehicle.js:482-500`) jumps from **2.29 m to
  6.11 m**. The car is at z −18.16, x −4.58, and the footprint has left the last roof under its track (`roofBelow` →
  0). `landWantAt` (`vehicle.js:468-473`) swaps the roof floor for the ground's profile, so the sink LAND wants
  jumps from 5.67 to **10.73 m/s**. The car is now "ahead" of its profile, and the governor
  (`vehicle.js:451`) stops lifting until the ground profile catches up.
- **It isn't one unlucky line.** Held sideways slides of 0, +8, +12, +16, +20, +24 and +32 px each have a 0.14–0.32 s
  jets-off gap at 5.4–7.0 m, with the sink rising 1.3–3.1 m/s. Slides of −12 and −24 px have a 0.15–0.17 s gap at
  7.0–7.5 m. Only +40 and +48 px (which land 15–17 m wide) brake in one pulse.
- **The Lineup reference** (`createAutopilot('lineup')`, "Watch the reference") has the same hand-off at the end of
  its row (z 22.8): 0.21 s off at 3.1 m, sink 5.0 → 6.8 m/s.
- **The Wall has no roofs, so it brakes in one pulse.** One thumb, every slide from −24 to +48 px, one pulse. The
  Show and Wall references fly one pulse too.
- **It may feed 0164.** Where the gap opens depends on the car's x, so a sideways slide changes when and how long
  the car falls free, and that changes how long it drifts. Fixing this may remove part of 0164's cliff. Measure it.

## What
- `src/sim/vehicle.js`, LAND's altimeter and governor: a roof that passes out of the footprint must not hand the
  governor a floor 3–4 m lower in one tick. Keep the planned stop continuous through the hand-off. For example,
  never let the wanted sink grow faster than the brake could have allowed from the previous tick, or blend the floor
  over the distance the car covers in the 0.6 s lookahead, or plan to the ground once braking has begun over a
  roof the car is carrying past. ROOF_HOLD's protection must not change: a car that stops over a roof still sets
  down on it gently.
- This is a sim change: bump `SIM_VERSION`, regenerate the replay fixtures and `npm run vectors` in the same
  PR (control.json parallel_focus), and re-check every pilot that plans against the brake law (LESSONS: "A late,
  hard brake has no slack").

## Acceptance criteria
- [ ] Node, the one-thumb Show (`thumb-mastery.test.js` harness, held from the tap): from the first tick the
      specific force reaches 1.5 g to touchdown, there's **no span of 0.08 s or longer under 0.5 g** while sinking
      faster than 2 m/s. The same holds for held sideways slides of −24, −12, 0, +8 … +48 px (step 4). A unit test,
      e.g. in `tests/unit/gtrace.test.js`, sweeps them.
- [ ] The same check passes for the Show, Wall and Lineup references (`createAutopilot`) and for
      `human-show.mjs 60 assist --cues=new`'s flights that land clean.
- [ ] On those flights, sink never rises by more than 0.5 m/s after the brake has first slowed it below 9 m/s
      (the reveal's sink only falls from the onset to the flare).
- [ ] No flight in the sweep lands on a roof or touches one (`contact` false) where it didn't before. A car that
      stops over a roof still sets down there at ≤ 1.5 m/s.
- [ ] The one-thumb Show held from the tap still lands clean at touchdown sink ≤ 1.3 m/s, the gas left stays within
      3 percentage points of today's, and release → touchdown stays 4.0–5.5 s.
- [ ] `naive-players` 32/32, `naive-show` ≥ 51/54 over the row, `daily-reach.mjs 150` every objective ≥ 30 %.
      Node, Chromium and WebKit replays are IDENTICAL. `npm run vectors` is regenerated and checked.

## Test plan
`tests/unit/gtrace.test.js`: add the per-tick no-gap assertion over the one-thumb slide sweep and the three
references. `setdown.test.js`, `fan.test.js` and the roof set-down tests stay unchanged and green.

## Out of scope
Moving the reference's peak height up to 5–8 m (0028). The one-thumb slide's sideways response (0164), apart from
re-measuring it after this lands.
