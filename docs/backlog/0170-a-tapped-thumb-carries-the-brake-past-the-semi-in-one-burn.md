---
id: 0170
title: A tapped thumb carries the brake past the semi in one burn, like a held one, with no stop in the air over the truck
status: proposed
priority: P1
size: M
lens: authenticity
created: 2026-11-06
pr:
by: critic
---

## Why
The reveal's landing sink only ever falls. It's about 14 m/s at 12 m and about 1.5 m/s by 2.5 m, followed by a 1–1.5 s
hover under 3 m (docs/REVEAL_RESEARCH.md §2.1.4, TELEMETRY at 2 Hz). The real car never parked in the air over a
truck and then sank off it.

On one thumb, the phone's default and the focus's first priority, two flights diverge:
- **Held from the tap**, the Show carries the brake past the semi in one burn: sink 15.0 → 8.0 → 5.7 → 1.9 m/s at
  13.3 / 7.2 / 4.3 / 2.3 m, Stuck it 84.7.
- **Tapped**, the most common thumb, flies something else. That's a tap on the ledge, a lift, then a press again
  later or never; 89 of 120 thumbs in `scripts/human-phone.mjs:201`. Pressing again at 1.5, 2.0 or 2.5 s and never
  pressing give the same flight to the tick (critique `docs/critique/2026-11-06-1600.md` §1):

| after release | height | sink | specific force |
|---|---|---|---|
| 1.7–2.5 s | 11.5 → 5.4 m | 14.5 → 1.5 m/s | 2.5–2.9 g |
| **2.6 s** | **5.3 m** | **−0.1 m/s** | **stopped over the semi's end** (z −19.3) |
| **2.7–3.3 s** | 5.3 → 4.3 m | **0.4 → 3.2 m/s** | 0.46–0.52 g (`LAND_CAP_FLOOR`) |
| 3.4–3.8 s | 3.9 → 2.3 m | **4.0 m/s at 2.5 m** (the reveal: ≈1.5) | 0.6–1.3 g |
| 3.9–4.3 s | 2.0 → 1.1 m | 3.3 → 1.5 m/s | a second burn, 1.8 g |
| 5.11 s | wheels | 1.30 m/s | Clean 83.7, 6.1 m from the mark |

`human-phone.mjs 120 --scheme=thumb` prints the count itself: the sink rises > 0.5 m/s above 1.2 m on **89/120**
clean landings for none, careful and sloppy alike.

Production shows it (390×844 touch, first visit, `docs/critique/2026-11-06-1600/`):
- At 5.7 m: FALL 1.6 ft/s, "BRAKE · ON PROFILE" (`repress-6-hover.jpg`).
- At 3.7 m: **FALL 12.7 ft/s at G 0.6 g**, and the state box says **"HOLD · LAND" to a thumb that is holding the
  pad** (`repress-6b-low.jpg`; `src/hud-landing.js:200-203` shows `THUMB_WORD` for anything off green).

The same car on the same course passes the semi in one burn when the thumb was held. So this isn't the physics
limit 0169's second pass hit, where a car that has already stopped over the roof can't descend slowly. It's what
LAND does before the stop. The two flights part in the first second after the release:
- Held, LAND is on from the release, the car rolls out early, and it brakes at 1.0–1.1 G from 0.9 s.
- Tapped, it's 0.3–0.7 G. The tapped car arrives over the row lower and faster (18.1 m at 13.8 m/s against 19.6 m
  at 10.2 m/s at 1.3 s), brakes 2.6 G from 10.8 m, and reaches ROOF_HOLD over the semi.

It probably also drives 0164's bounce: the tapped thumb's +8 px slide hovers 0.38 s over the semi and lands 3.7 m the
wrong way.

## What
Diagnose first. Print where the held and tapped flights part: `out.level`, `st.landing` and Assist's auto-land
arming in `src/onethumb.js` `sample()`, and LAND's plan in `src/sim/vehicle.js`. Then make the tapped flight fly the
held one's line past the semi. Two options to measure:
- **LAND and roll-out.** When Assist's auto-land flies a car the thumb lifted off, it takes the same roll-out and
  brake onset the held thumb gets from the release.
- **The roof hold.** LAND's roof hold doesn't brake to a stop over a roof the car's along-track speed carries it
  past before it would reach ROOF_HOLD's height. It keeps braking to the ground's profile beyond the roof, the way
  the held flight does at 0.5 m over the roof edge, with ROOF_HOLD's clearance unchanged.

Also, `stateWord` on one thumb doesn't ask a thumb that is already down to "Hold · land" (`src/hud-landing.js`).
Name the state, or say nothing.

If the ref-hash moves, it's a sim change: bump `SIM_VERSION`, regenerate the replay fixtures and `npm run vectors`
in the same PR, and re-check every pilot that plans against the brake law (LESSONS "A late, hard brake has no
slack").

## Acceptance criteria
- [ ] Node, the one-thumb Show (`gtrace.test.js` `thumbBurn(x, again)`): tapped, lifted at +20 ticks, pressed
      again at 1.0, 1.5, 2.0, 2.5 s or never, at 0 and ±24 px. On every flight:
      - no tick above 4.5 m with sink < 1 m/s after the peak sink (no stop over the semi)
      - the sink rise after the brake first slows it below 9 m/s is ≤ 0.5 m/s above 1.2 m
      - sink at 2.5 m ≤ 2.5 m/s (the reveal: ≈1.5 m/s)
      - no contact, and touchdown ≤ 1.5 m/s
- [ ] `human-phone.mjs 120 --scheme=thumb --skill=none|careful|sloppy`: the "sink rising > 0.5 m/s above 1.2 m"
      count it prints falls from 89/120 to ≤ 6/120. Jets-out gaps stay 0/120, clean stays 120/120, and the medians
      don't fall.
- [ ] Release → touchdown on the tapped thumb ≤ 5.0 s (today 5.11; held 4.93). Gas at the wheels within 3 points
      of today's (27.1 %).
- [ ] Held from the tap: bit for bit as today, or no worse on gtrace's existing sweeps.
- [ ] 390×844 touch: with the thumb down, the state box never reads "Hold · land". Assert it in an e2e or a unit
      test on `stateWord`.
- [ ] `naive-players` 32/32, `naive-show` ≥ 51/54 over the row, `daily-reach 150` every objective ≥ 30 %. Node
      and Chromium replays IDENTICAL.
- [ ] The funnel number this should move: `run-landed` → `retry` among one-thumb runs (digest `players`).

## Test plan
- `gtrace.test.js`: add the tapped sweep with the per-tick rules above, next to the existing pressed-again test.
  That test asserts only no gap and sink ≤ 4.5 m/s.
- `hud-landing` unit: `stateWord(status, upY, thumb, held)` never asks a held thumb to hold.

## Out of scope
- The reference's peak height (0028).
- The sideways slide's mapping (0164), apart from re-measuring its tapped-thumb table after this lands.
- Classic touch and keys.

## Builder note 2026-11-06 (not built: back to proposed, needs a decision)
Diagnosed on main `8322c47` (SIM_VERSION 30) in Node, with gtrace's `thumbBurn` harness and per-tick governor prints.

**Where the flights part.** It's the roll-out, not LAND's plan. Held, LAND is on from the release and the car is roof up
(uy 0.86) by 0.8 s. Tapped, Assist's auto-land arms at 0.6 s and the car is still inverted at 1.0 s (uy −0.37) and roof up
at ≈1.35 s. So it gets to the row at 15 m/s at 13 m, 1.5 m further right. Held, the car crosses the semi's end beside it
(x −4.56, outside its 3.16 m + half a car), sinking 5.6 m/s. Tapped, at x −3.64 its footprint is 0.5 m over the semi's
corner. LAND's roof hold (`landWantAt`, ROOF_HOLD 1.2 m) binds from 1.8 s and brakes it to a stop at 5.3 m.

**It can't pass that corner at speed from where it is.** At 1.8 s (h 10.2, sink 12.7) the floor has 4.3 m to spare over
the semi and the tail stays over it for another 0.76 s. Any brake that keeps ROOF_HOLD has to end at sink ≈ 0. At 1.4 s,
the first tick roof up, a pass is just possible at ≤ 2 m/s.

**What I measured (reverted, nothing shipped).** I tried option 2 of What, LAND passing a roof whose end is in sight: plan an
even brake that crosses the end ROOF_HOLD over it at vEnd (≤ 3.5–8 m/s), and scan ≤ 8 m past the 0.6 s look-ahead
for the end. It does take out the stop: sink 4.2 → 3.9 → 4.0 m/s past the semi, one burn, no contact. But the early
brake costs the tapped thumb, at every vEnd and scan length tried (tapped, no slide):

| | main | vEnd 3.5 | vEnd 5 | vEnd 8 |
|---|---|---|---|---|
| touchdown after release | 5.11 s | 5.13 | 4.84–4.98 | 4.92 |
| padMiss / score | 6.2 / Clean 83.7 | 9.0 / 74.7 | 9.9–11.3 / 71.3–73.3 (Rough at scan 3+) | 9.0 / 74.7 |
| clearance over the row | **1.3 m** | 3.4 | 3.9–4.0 | 4.9 |

Held from the tap moves by ≤ 0.7 points either way.

**The conflict.** The tapped thumb's stop over the semi *is* the skim. `skim-show` (0150) is met by exactly that flight:
"let go right after the tap" gives 1.3 m, held gives 4.5 m. daily-reach's ≈ 70 % on one thumb is these flights. Any fix
that keeps the car from reaching the semi's end low and slow lifts the tapped thumb to 3.4–4.9 m, past `skim-show`'s 1.5 m bar on every tapped line
measured, so the Daily the sheet teaches would be out of reach on one thumb. (I didn't run `daily-reach` on the variant;
the clearance alone misses the bar.) It also costs 9–13 points of precision. So this ticket's bar
("no stop over the semi" with "medians don't fall" and daily-reach ≥ 30 %) can't be met by LAND's plan alone. Options
for the operator or the Critic:
- (a) Move the skim. Retire or re-word `skim-show` on one thumb (e.g. "under 2.5 m", or skim the Lineup), then fly option 1:
  the tapped thumb's auto-land rolls out from the release as LAND does (`onethumb.js`: `st.landing` from the release).
  That is the held flight, minus the slide.
- (b) Keep the skim and accept a slow pass over the semi's corner (sink ≥ 1 m/s, a rise of ≈ 1 m/s), relaxing this
  ticket's "no tick above 4.5 m under 1 m/s" and "rise ≤ 0.5".
- (c) Keep both, and take the tapped car off the semi's corner sideways (its footprint is 0.5 m over it). That is a carry
  or line-hold change, and it moves the touchdown (0164's frame).
0164's tapped-thumb bounce (+8 px hovers 0.38 s over the semi) waits on the same decision.
