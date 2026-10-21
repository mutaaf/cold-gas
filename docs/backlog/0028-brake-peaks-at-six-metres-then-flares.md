---
id: 0028
title: The landing brake peaks near 6.5 m, eases to a near-hover, then flares, like the livestream G trace
status: ready
priority: P1
size: M
lens: authenticity
created: 2026-10-21
pr:
by: critic
---

## Why
The reveal's most-quoted landing number is a height: "the G-force readout jumped to 3.3 G at about
6.5 metres off the ground" (docs/REVEAL_RESEARCH.md §2.1.4, REPORTED paultan; TELEMETRY at 2 Hz).
Run 2's trace, by altitude: braking starts high (1.7 G at 12.0 m), peaks at **3.3 G at 6.5 m**, eases
to **1.0 G at 3.1 m** and **0.3 G at 2.3 m**, then flares (**1.4 G at 1.2 m**) and touches down
**2.5 s after the peak**. The car hovered 1–1.5 s below 3 m.

Measured on main 5a5ecf2 (SIM_VERSION 24), reference runs, 0.5 s-mean specific force by Δv
(docs/critique/2026-10-21-2200.md):

| after release | Wall G / alt | Show G / alt | Reveal G / alt |
|---|---|---|---|
| 2.0 s | 0.06 / 14.2 m (sink 14.2) | 0.03 / 14.9 m | 3.3 / 6.5 m |
| 2.5 s | 1.22 / 6.6 m | 1.39 / 7.7 m | 1.0 / 3.1 m |
| 3.0 s | 3.04 / 2.3 m | 2.17 / 2.5 m | 0.3 / 2.3 m |
| 3.5 s | 1.37 / 1.5 m | 2.19 / 1.1 m | 1.4 / 1.2 m |

`brakePeakG` 3.08 G at **3.3 m** (Wall) and 3.02 G at **2.3 m** (Show); the results card prints
"3 g braking peak at 2.3 m" on production. The peak value is right; its height is a third to a half
of the reveal's, the brake is still in free fall at 14 m, and there is no ease-off and no flare: the
car is going 11.8 m/s at 6.2 m over the row on the phone (`phone-5-over-row.jpg`). The 0013 gate only
asks "below 10 m", and the 03:45 critique deferred this until 0014's set-down law landed. It has.

## What
- `src/sim/vehicle.js` brake planner / governor (`brakePlan`, `stopFull`, the LAND set-down): plan the
  stop so the peak falls at 5–8 m, then hand over to the low-height set-down that eases toward 1 G and
  flares just before contact. Re-read LESSONS "A late, hard brake has no slack" and "A pilot's
  time-to-go carries the profile it was written for": every pilot (Wall, Show, Lineup, cues) that
  plans against the brake law must be re-checked.
- The lip is 27.7 m against the reveal's ≈20 m (operator's call), so match the trace **by altitude**,
  not by time after release.
- Gas: braking higher costs nitrogen. Report kg used lift-off/release → wheels before and after; the
  Show must still land with its one fill.
- Bump `SIM_VERSION`, regenerate replay fixtures, tighten `tests/unit/gtrace.test.js`.

## Acceptance criteria
- [ ] Wall and Show references: `brakePeakG` 2.8–3.6 G with `brakePeakH` **5.0–8.0 m** (telemetry
      3.3 G at 6.5 m; gtrace.test asserts it).
- [ ] Wall reference: specific force ≥ 1.2 G (0.5 s mean) is reached above 9 m (telemetry 1.7 G at
      12 m).
- [ ] Wall reference: between the peak and 1.5 m the 0.5 s mean falls to ≤ 1.1 G at least once (the
      reveal's ease to 1.0 / 0.3 G), and the last 0.5 s before contact averages 1.1–1.6 G (flare 1.4 G).
- [ ] Wall reference: peak → touchdown 1.8–3.0 s (telemetry 2.5 s); release → touchdown stays
      4.0–5.0 s (Wall) and < 6 s (Show); touchdown sink ≤ 1.5 m/s; Wall set-down below 3 m 1.6–2.4 s.
- [ ] Results card's "braking peak at" reads the new height (unit test on `card.facts.brakeH`).
- [ ] `naive-players` 32/32, `naive-show` ≥ 51/54 over the row, `human-show.mjs 300 assist --cues=new`
      cue followers ≥ 95/100; Lineup `setdown-probe` still meets 0014's bars.
- [ ] Node, Chromium and WebKit replays IDENTICAL.

## Test plan
`tests/unit/gtrace.test.js`: replace "below 10 m" with the 5–8 m band, add the onset, ease and flare
checks above by altitude. `setdown.test.js` and `fan.test.js` unchanged and green.

## Out of scope
The lip height, touchdown bottoming (0017), the kickflip's own profile beyond keeping 0014's bars.
