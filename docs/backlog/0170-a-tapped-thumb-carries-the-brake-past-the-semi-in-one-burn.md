---
id: 0170
title: A tapped thumb carries the brake past the semi in one burn, like a held one, with no stop in the air over the truck
status: ready
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
