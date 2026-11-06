---
id: 0164
title: On one thumb, a held sideways slide moves the touchdown the way it points, more for more, and never off the pad
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-05
pr: 272
by: critic
---

## Why
The slide is the one skill input on one thumb (0121), and the focus's item 1 is "skill that shows in the score". A
skill input has to be monotonic: more slide, more move, in the direction of the slide. On the Show it isn't. Critique
`docs/critique/2026-11-05-1300.md` §1 flew the one-thumb Show in Node with the page's own code (`createOneThumb`, the
`thumb-mastery.test.js` harness): hold from the tap, and once the pad's sight is drawn (roof up, `src/thumb-aim.js`),
slide the thumb sideways by X px and hold it there. Without a slide, the car lands 5.3 m left of the mark (padMiss 6.0,
Stuck it 85.7). The sight draws the mark ≈ 36 px right.

| held slide (px) | lateral at touchdown | padMiss | verdict |
|---|---|---|---|
| 0 | −5.3 m | 6.0 | Stuck it 85.7 |
| +8 | −4.8 | 5.5 | Stuck it 88.0 |
| +10 | −3.9 | 4.6 | Perfect 10 92.0 |
| **+12** | **−9.3** | **9.8** | **Clean 74.7** (further left than no slide) |
| +14 | −6.9 | 7.4 | Clean 79.0 |
| +16 | −5.2 | 5.7 | Stuck it 87.0 |
| +18 | −3.4 | 4.1 | Perfect 10 93.7 |
| +20 | −1.7 | 2.7 | Perfect 10 95.3 |
| +32 | +6.0 | 7.1 | Clean 78.7 |
| **+36** (the dot drawn on the mark) | **+16.7** | **16.9** | **Rough landing 67.0**, 1.1 m over the roofs |
| +40 … +48 | +14.3 … +16.5 | 14.8 … 16.7 | Rough landing 67–68 |
| **−12** (a 2 mm slip the wrong way) | **−17.4** | **17.9** | **Rough landing 67.3** |
| −24, −36 | −28.0, −32.8 | 28.6, 33.4 | Rough landing 66, 65.7 |

So between 10 and 18 px the touchdown swings ±3 m for every 2 px, and the wrong direction half the time. A thumb put
where the sight puts the dot (≈ 36–40 px, `inv(shape)` of the drawn mark) and held turns a Stuck it into a Rough
landing 16 m off. A 12 px slip the wrong way does the same 18 m the other way. `AIM_PX_PER_M = 6` (`src/onethumb.js:187`)
promises 6 px a metre. The flight gives anywhere from 0 to 0.6 m a pixel, of either sign.

A thumb that keeps re-reading the dot (0.2–0.3 s late, 100–1000 px/s) still lands 2.0–3.2 m off (Perfect 10,
95.3–95.7), because it corrects the swings. So the skill is reachable, but the control under it is a cliff, and a
newcomer who slides once and holds, as the sheet's "slide onto the amber dot" reads, gets punished for doing it.

The likely causes are in `src/onethumb.js:155-168`. The roll is live from ≈ 23 m up, as soon as the car is roof up,
over the row, for about 3 s. `flankAhead` gates it on and off each tick, and that on/off is the non-monotonic part.
Diagnose before changing.

## What
In `src/onethumb.js` (and only there, unless the diagnosis says otherwise), make the sideways slide a proportional
control over the touchdown, the way `AIM_PX_PER_M` says. A held slide of X px moves the predicted touchdown
≈ X / 6 m toward the side slid, and it saturates at the full command, not past the pad's outer ring. Options to measure:
- a rate limit on the slide's roll, scaled by the time left to touchdown
- a closed loop on `predict`'s touchdown, the way `steerToPad` does in `src/sim/autopilot.js`
- a flank gate with hysteresis instead of tick-by-tick on/off

This is a sim-input change, not a sim change: the log, replay and scorer are untouched. If the ref-hash moves,
`SIM_VERSION` and vectors follow the usual rules.

## Acceptance criteria
- [ ] Unit (extend `tests/unit/thumb-mastery.test.js`): the one-thumb Show held from the tap, a held sideways slide
      from −48 to +48 px in 2 px steps. Lateral at touchdown is monotonic in the slide (non-decreasing within 0.3 m
      noise). Every flight lands ≤ 8 m from the mark (the outer ring is 7 m, `src/sim/courses.js:192`), with no
      Rough landing and no contact.
- [ ] Unit: a slide held where the sight draws the dot at its first frame lands ≤ 3.5 m from the mark (the mark Daily's
      bar, `src/daily.js:45`).
- [ ] Unit: the re-reading thumb above (0.2–0.3 s late) still lands ≤ 3.5 m, and `naive-players` stays 32/32.
- [ ] `node scripts/human-phone.mjs 150 --scheme=thumb --skill=careful` lands no worse than today: write both numbers in
      the PR.
- [ ] Funnel number to move: `run-landed` per `run` and `retry` per `run` among one-thumb runs (digest `players`).

## Test plan
Add the slide sweep to `thumb-mastery.test.js`, with the harness from `docs/critique/2026-11-05-1300.md` §1 (the probe
is described there). Keep the existing "no slide, however wild, lands on the row" test.

## Out of scope
- The along-track (up/down) half of the slide: that's 0165.
- The sight's drawing (`src/thumb-aim.js`), unless the scale changes.
- Classic touch, keys and Advanced.

## Critic sharpen 2026-11-06
Two things to add (`docs/critique/2026-11-06-0400.md` §1–2):
- **The Wall has the same shape, and today's Daily is on the Wall** (soft-wall, Nov 6). One-thumb Wall, held from the
  tap, Node harness. No slide lands 6.1 m right and 9.7 m long (padMiss 11.4, Stuck it 90.7). Held sideways
  slides give lateral **−12 px → +8.7 m** (worse than no slide, the wrong way), **−24 → −1.9**, **−36 → −7.6**,
  **−48 → −5.8**, **+12 → +16.2**, **+24 → +26.6**, **+36 → +29.7**. Again there's a sign flip between 12 and 24 px,
  and a 10.6 m swing for 12 px. The Wall's up/down half does work (0, −24 → landZ −9.8, padMiss 7.2, 93), so the
  sideways defect isn't only the Show's row gate.
- **0169 may feed this on the Show.** The down-jets' mid-brake gap opens at the row's last roof, and its timing
  depends on the car's x (slide +12: 0.20 s off from 6.7 m; +32: 0.32 s off from 5.4 m). Re-measure this ticket's
  table after 0169 lands, before tuning `AIM_PX_PER_M` or `flankAhead`.
- [ ] The monotonic and proportional criteria above hold on the Wall too (held sideways slides −48 … +48 px, step 4).

## Builder note 2026-11-06 (shipped)
Diagnosis first, re-measured on main after 0169 (Node, the `thumb-mastery` harness). The cliff wasn't only `flankAhead`.
A slide was a roll held open for ≈ 3 s, and any roll over 0.05 switches off LAND's hold-the-line, so the touchdown
integrated the slide (−24 px: 29 m off) and was never measured from anything.

What changed (`src/onethumb.js`, mirrored in `OneThumb.swift`):
- **Sideways is a place.** `ref` is where LAND's own hold would set the car down sideways (here, plus the drift the
  hold carries off, `lead` = t / (1 + t / 2τ), τ 1.8 s, fitted on the sweeps). It is read until the slide leaves the
  dead zone. X px moves it X / 6 m, clamped 6 m inside the mark's side (never the other way). The roll flies the
  hold's own law (0.07 rad per m/s, ×3, up to the old full roll) about the drift that ends there. With no slide the
  flight is bit for bit as before.
- **The sight uses the same frame.** `markOffset(…, ref)` lays the mark out sideways from `ref`. The page
  (`thumb-aim.js`), human-phone, daily-reach, the vectors' sights and the Swift HUD all read it that way, so the
  dot stays where to put the thumb.
- **Inward on the Show waits for the semi.** The no-slide flight leaves the semi's end 0.16 m outside its roof
  edge. Pulled in from over the row, the car crossed that edge low, and LAND stopped it at 5.3 m (0169's roof hold).
  That cost 1.5 m along the run, and gtrace's "passes the semi in one burn" broke at +20 px. An inward slide now
  waits until the car is past the semi (the sight dims, `aimLive` false), then the loop takes the whole move.
  Outward slides never wait.

Measured (main → this). The Show held from the tap, sideways:

| slide | main lateral / padMiss | now |
|---|---|---|
| −24 | −28.7 / 29.4 | −6.2 / 6.4 (clamped at the ring) |
| −12 | −17.7 / 18.3 | −6.2 / 6.4 |
| −8 | −5.6 / 6.5 | −6.2 / 6.5 |
| 0 | −5.1 / 6.0 | −5.1 / 6.0 (identical) |
| +8 | −4.6 / 5.6 | −3.5 / 4.6 |
| +12 | **−9.4 / 10.0** | −2.7 / 3.9 |
| +16 | −5.0 / 5.8 | −1.9 / 3.3 |
| +24 | −1.6 / 3.1 | −0.4 / 2.3 |
| +32 | 5.8 / 6.8 | 0.3 / 1.9 |
| +36 (the dot) | **17.7 / 17.8 Rough** | 0.4 / 1.8 |
| +48 | 17.6 / 18.1 Rough | 0.5 / 1.9 |

The Wall sideways: −48 → −3.6, −24 → 1.9, −8 → 5.3, 0 → 6.1 (main: −12 → 8.7, +12 → 16.2, +24 → 26.6). Positive
slides there leave it at 6.1, because the hold's touchdown is already past the 6 m clamp on that side.

- Acceptance: Show −48…+48 step 2 monotonic (within 0.3 m), ≤ 6.5 m, no Rough landing, no contact. Wall step 4
  monotonic, no contact. ±8…+24 px move 0.5–1.5 × X/6 (Show +8…+24 ≈ 1.2×; Wall −8 0.6×, −48 1.2×). First-frame dot
  held: Show 2.2 m, Wall 1.3 m. Re-reading thumb 0.2–0.3 s late: Show 1.8 m, Wall ≤ 2 m. All in
  `tests/unit/thumb-mastery.test.js`.
- `naive-players` 32/32. `human-phone 150 --scheme=thumb`: careful 150/150 clean, median 93 → 94 (p90 95.3 → 94.7, max 95.7 → 94.7: the top
  end gives a little); sloppy median 91 → 93.3, min 78 → 83.7; none identical; jets-out gaps 0 in every group.
- `daily-reach` (n 40, the test's sample): mark-show 17 → 21, gas-show 19 → 32, ninety 28 → 30, soft-wall 23 → 22,
  skim 31 → 28 (all over the 12 floor).
- A held slide no longer costs braking (Show sink: none 1.05, ±24…±48 px 1.04–1.09; main +48 1.80). So the
  one-thumb ran-out words drop "keep the slide small: a big slide tilts the jets off the brake", and learn.test now
  pins the new fact.
- From the self-review: a hold that has slid flies back to `ref` when the thumb comes back to the middle (re-reading `ref`
  mid-drift handed a fast drift back to LAND's 0.2 rad hold: −48 px centred at 10 m landed 8.9 m wide, now 4.6). The
  command saturates at a full slide. The sight's `m` ('near') is the miss as the dot shows it. The ink dot sideways is
  drawn at the slide's px, so ink on amber is the touchdown on the mark.
- Known, left: the sight falls back to the ballistic side for the instant the thumb is up (it jumps 4–18 px on a
  lift). The 3D touchdown ring is still ballistic. A slide started late (under ~12 m) has less room, and a late right
  slide on the Wall moves it 0.8 m left (the clamp works from the predicted `ref`). On the Show the inward move is
  flown low, after the semi.
- Not changed: the along-track half (0165). On the Show a held slide's landZ is still about −32…−34.
- Funnel numbers to move: `run-landed` / `run` and `retry` / `run` among one-thumb runs, and `daily-done` on mark-show days.
