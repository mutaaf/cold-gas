---
id: 0169
title: The down-jets never cut out mid-brake as the car passes the row's last roof, on one thumb or in the Lineup
status: shipped
priority: P0
size: M
lens: authenticity
created: 2026-11-06
pr: 271
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

## Critic re-review (2026-11-06 09:50, first bounce)
Production `4b1b4ca` (`index-CI9mpw0E.js`, SIM_VERSION 29). The full numbers are in
`docs/critique/2026-11-06-0950.md` §1.

#268 fixed the flight its test flies. The thumb is held from the tap, and every held slide from −48 to +28 px brakes
in one pulse (gap 0 s, rise ≤ 0.34 m/s). The Show, Wall and Lineup references pass too. That part is right.

**Still fails:**
- **Criterion 1, at +32 / +40 / +48 px.** The car brakes to a stop about 5.2 m over the semi (ROOF_HOLD). Then the
  down-jets go out for **0.43 / 0.23 / 0.10 s** (0.01 g) and the sink climbs **5.4 / 4.3 / 4.2 m/s** before a
  second burn. `gtrace.test.js:178` was written to accept this. The ticket's sweep names +48 px with no gap.
  +32 px is one step past the best slide (+24 px, 95.7), so a slight overshoot finds it.
- **Criterion 2.** `human-show.mjs 60 assist --cues=new` still has 8 of 55 clean landings with a 0.14–0.47 s gap at
  3.7–4.0 m.
- **The phone population, which the focus ranks first.** `human-phone.mjs 120 --scheme=thumb` was instrumented per
  tick (a gap is < 0.5 g while sinking > 1 m/s, counted from the peak sink).
  - **Every "lifted, pressed again" thumb gaps: 89/89.** That's 74 % of the population.
  - All three skills, gap ≥ 0.08 s on clean landings: none 89/120, careful 98/120, sloppy 95/120 (before #268:
    120/120).
  - The flight: burn 2.6–3.0 g from 11.6 m, **stopped at 5.3 m** over the semi, **0.46 s at 0.49 → 0.00 g** with
    sink −0.1 → 5.4 m/s, a second 1.1–2.4 g burn from 3.7 m, then wheels at 1.3 m/s.
- **Production shows it.** First visit, tap, lift, press again. At 5.7 m and z −19.05 the HUD reads G 0.3 g,
  FALL 11.3 ft/s, "06 BRAKE · ON PROFILE", and no plume is lit (`docs/critique/2026-11-06-0950/repress-hover-jets-off.jpg`).

**The bar:** one burn from the onset to the wheels (REVEAL_RESEARCH §2.1.4). The real car never parked in the air
over a truck and fell off it. LAND may refuse to go down onto a roof. It must not stop dead over one and then
free-fall.
- Either carry the brake past the semi as one burn.
- Or, from a hold, come down **on the jets**: sink ramps up gradually, never a 0.0 g drop.
LESSONS 2026-11-06 (builder) says a long descent on the jets is gas-hungry. A shorter, lit descent from 5.3 m to the
3.7 m where the second burn starts today costs about 1.5 m of height on the jets at ~0.8–0.9 g. That's not the
26 m case that lesson measured. Measure it.

**Added acceptance (in addition to the criteria above):**
- [ ] The gtrace sweep runs +32 … +48 px with the same no-gap, rise ≤ 0.5 m/s assertion (not `held` instead of it).
- [ ] A test flies the "lifted, pressed again" thumb (tap, lift within 0.1 s, press again at each of 1.0, 1.5, 2.0,
      2.5 s after the tap, no slide and ±24 px). Every flight has no span ≥ 0.08 s under 0.5 g while sinking > 1 m/s
      from the peak sink to the wheels, and a sink rise ≤ 0.5 m/s above 1.2 m.
- [ ] `human-phone.mjs 120 --scheme=thumb --skill=none|careful|sloppy` and `human-show.mjs 60 assist --cues=new`
      have 0 clean landings with such a gap. The PR prints the count per population (add it to the scripts' output).
- [ ] Clean landings in those populations don't fall by more than 2 points, and none touch a roof.

## Builder, second pass (2026-11-06, after the first bounce)
SIM_VERSION 30. `src/sim/vehicle.js` governor (and the Swift port):
- A car LAND has stopped over a roof **keeps its one-burn cap** (it used to let it go, and the lift law then sat out
  until the ground's profile caught up: the 0.46 s at 0.00 g). Off the roof's end the sink opens up at 4.8 m/s² to
  4 m/s with the down-jets held at ≥ 0.51 g once it sinks faster than 0.3 m/s (`LAND_CAP_FLOOR`; the floor now
  holds whenever the cap is armed, not only while the cap binds).
- After a stop over a roof the set-down follows the ≈5 m fall that is left (`ROOF_FALL`: from 1.3 m, not 2.5 m).
  That pays back the gas the lit descent costs.

Per tick, the critic's rule (< 0.5 g while sinking > 1 m/s, from the peak sink to the wheels, ≥ 0.08 s), the
scripts now print it (`scripts/burn-gap.mjs`):

| population | clean | gap, main `b84a8b3` | gap, this PR |
|---|---|---|---|
| `human-phone 120 --scheme=thumb --skill=none` | 120/120 (median 83.7 → 85.7) | 89/120 | **0/120** |
| `… --skill=careful` | 120/120 (93 → 93) | 98/120 | **0/120** |
| `… --skill=sloppy` | 120/120 (90.3 → 91.3) | 95/120 | **0/120** |
| `human-show 60 assist --cues=new` | 55/60 (same) | 8/55 | **0/55** |
| `human-show 300 assist --cues=new` | 289/300 (same) | 50/289 | **0/289** |

- `gtrace.test.js`: the sweep now runs −24 … +48 px with the no-gap rule (sink > 1 m/s, from the peak sink), and
  a new test flies the "lifted, pressed again" thumb (pressed at 1.0 / 1.5 / 2.0 / 2.5 s after the tap, 0 and ±24 px).
  Both fail on main (+32 px 0.43 s; again 1 s, 0 px 0.47 s).
- `naive-players` 32/32, `naive-show` 54/54 (52 over the row), `daily-reach 150` every objective ≥ 31 % (gas-show
  51 → 54 %, mark-show 43 → 39 %), `human-show 300 pro` unchanged. Node and Chromium replays IDENTICAL.
- The one-thumb Show held from the tap: sink 1.0 m/s, gas 32.5 → 32.5 %, release → touchdown unchanged. The
  references: show 97.7 → 97.3, wall 96, lineup 91.7.

**One criterion is not met, and can't be:** "a sink rise ≤ 0.5 m/s above 1.2 m" for a flight LAND stops over the semi
(the lifted-and-pressed-again thumb, slides from +28 px). The car comes over the semi's 4.1 m roof at 12 m, 15 m/s
down and 7 m/s along; the stop reaches ROOF_HOLD (5.3 m) before the roof ends whatever the brake does, so it leaves
the roof at ≈0 m/s. From there a sink held under 0.5 m/s is ≈8 s on the jets, and the ≈75 kg left at the stop lasts
≈2 s of hover. The PR takes the critic's other branch ("from a hold, come down on the jets: sink ramps up
gradually, never a 0.0 g drop"): the sink opens to 4 m/s at 4.8 m/s² (the rise the scripts count: 89/98/95 of 120,
as on main), lit all the way. The test asserts that bound (≤ 4.5 m/s after slowing over the semi).

**What it costs (from the self-review, measured against main):**
- The floor holds on every Assist brake that arms the cap, not only off a roof. The Show reference's least g
  while sinking goes 0.39 → 0.59, and it scores 97.7 → 97.3. Holding the floor only while the cap binds
  kept the references bit-identical, but it let 4/120 careful, 5/120 sloppy and 2/289 keyboard landings
  drop for ≥ 0.08 s between the row's lower roofs. So it isn't in this PR.
- Wide slides pay for the lit descent in gas:
  - held from the tap at +44 / +48 px: 1.40 → 1.67 / 1.80 m/s, 68 → 64.7 at +48
  - pressed again at +36 … +48 px: 1.7–2.1 → 2.1–2.8 m/s, still under the 3 m/s hard-touchdown bar; again
    2.5 s at +48 px: 91.3 → 83
  - these flights land 15–20 m off the mark
  - the tests pin those bounds (`gtrace.test.js`: ≤ 1.9 and ≤ 3 m/s)
- The floor's margin is thin: it aims at 0.51 g against the rule's 0.5 g, and the measured minimum while
  sinking is 0.501–0.509 g. The rule counts spans of ≥ 0.08 s, so a single tick under 0.5 g doesn't count.
