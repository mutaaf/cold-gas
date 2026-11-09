---
id: 0165
title: On the Show, sliding up or down moves the touchdown along the run, as the sight draws it
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-05
pr: 276
by: critic
---

## Why
The pad's sight (`src/thumb-aim.js`, `markOffset` in `src/onethumb.js:188`) draws the mark in two axes: sideways, and
along the run (up = further, down = shorter). On the Show the one-thumb touchdown is 5.3 m left **and 2.7 m past** the
mark, so the dot sits right and slightly down, and the sheet's coach says "slide onto the amber dot". In Node with the
page's own code (critique `docs/critique/2026-11-05-1300.md` §2, the `thumb-mastery.test.js` harness), a held slide
straight up or down does nothing at all:

| held slide | aim live (pitch ≠ 0) | landZ | padMiss | total |
|---|---|---|---|---|
| none | 0 s | −32.7 | 6.0 | 85.7 |
| 0, ±12 px | 0.04 s | −32.7 | 6.0 | 85.7 |
| 0, ±24 px | 0.04 s | −32.7 | 5.9 | 85.7 |
| 0, +36 px | 0.04 s | −32.7 | 6.0 | 85.7 |

The pitch is gated by `rowBehind` (`src/onethumb.js:71-75`: z < rowFar − 2.5 = −20.1 m), and it fades out
below 2.5 m (`aimFloor` 1.5 + `aimFade` 1). The traced flight crosses z = −20.1 at h ≈ 3.3 m and is at h 2.5 by
z ≈ −21.8, so the window is a few ticks wide. Half of what the sight draws is a control that isn't there. A player who
slides onto the dot exactly gets the sideways half and wonders why they still land 2.7 m long. That's also the floor
under every careful thumb in 0164's measurements (2.0–3.2 m).

## What
Pick one and measure it:
- (a) Open the along-track slide while the car is still clear of the row's roofs, the way LAND already holds a floor
  over the roofs it's above. Use a predicted-clearance gate instead of the z gate, so "shorter" can't bring the car
  down on the row.
- (b) If (a) can't be made safe, draw the sight's along-track offset only when the slide can act on it, so the dot
  never asks for what the thumb can't do.

`src/onethumb.js` (and `src/thumb-aim.js` for b).

## Acceptance criteria
- [ ] Unit: the one-thumb Show held from the tap, a held slide of (0, ±24 px). With (a), landZ moves ≥ 1.5 m the
      way slid, with no contact and clearance > 0 in every case of `thumb-mastery`'s "however wild" sweep. With (b),
      the sight's `data-ey` is 0 while pitch can't act.
- [ ] Unit: a thumb that re-reads the dot (0.2–0.3 s late) lands ≤ 2 m from the mark on the Show (it reaches
      2.0–3.2 m today).
- [ ] `naive-players` 32/32, `naive-show` unchanged or better, and no new "Contact" in `human-phone.mjs 150
      --scheme=thumb`.
- [ ] Funnel number to move: Daily `daily-done` on mark-show and ninety-show days (digest `players`).

## Test plan
Extend `tests/unit/thumb-mastery.test.js` with the along-track sweep.

## Out of scope
- The sideways cliff (0164).
- The Wall and the Lineup, which have no row gate.

## Builder note 2026-11-09 (shipped)
(a), with (b) where (a) can't act. Diagnosed in Node with the `thumb-mastery` harness, held from the tap and tapped (lifted
at +20 ticks, pressed again at 1.0–2.5 s, LESSONS 2026-11-06): on main every up/down slide moved landZ by under 1 m held
(36 ticks of pitch), and the sight drew the mark from `predict`, which in free fall reads ≈11 m short.

What changed (`src/onethumb.js`, mirrored in `OneThumb.swift`; the Wall keeps 0121's pitch):
- **Along the run is a place**, like 0164's sideways: `refA` is predict's touchdown along the nose, read until the slide
  first leaves the dead zone; X px moves it X / 6 m (up = further), inside the ring and never shorter than the row's far
  edge + a car + 2.5 m. The pitch closes the gap over the time to go (2·err / (tGo² · 5.5)) and is out by 2.5 m up.
- **When it can act (`canA`)**: once the brake has turned the fall (sink 0.5 m/s past its peak), off every roof (over
  one LAND holds ROOF_HOLD and predict reads short), and while shorter has room: the roofs the car will cross (only
  those it is over or will be over sideways: the no-slide flight passes beside the last two cars) stay ≥ 1 m under its
  floor, projected at today's sink. Both ways or neither: allowing further earlier let sloppy thumbs carry 6 m long
  with no way back (25/150 out of the ring).
- **(b) The sight**: `markOffset(…, ref, refA, canA)` lays the mark out along the run from `refA`, and draws it along
  only while `canA`; `m` is still the whole miss. The page, human-phone, daily-reach, the vectors and the Swift HUD pass
  the thumb's own.

Measured (main → this), the Show, a held up/down slide, landZ (the mark is −30):

| thumb | −24 px | 0 | +24 px |
|---|---|---|---|
| held from the tap | −33.16 → **−31.37** | −33.18 | −33.21 → **−34.76** |
| pressed again 1.0 s | −32.97 → **−30.49** | −33.44 | −33.89 → **−35.35** |
| pressed again 1.5 / 2.0 / 2.5 s | −32.00 → **−29.91** | −32.31 | −32.60 → **−34.06** |

- Acceptance (`tests/unit/thumb-mastery.test.js`): held ±24 px move landZ 1.8 / 1.6 m the way slid; tapped −48 … +48
  px step 8 is monotonic, ±24 move ≥ 1.75 m; no contact, clearance > 0, no Rough landing in any of them or in the
  "however wild" sweep. A thumb with no up/down slide writes no pitch (flies as before). The sight's y is 0 on every
  tick `canA` is false.
- Re-reading thumb (0.2–0.3 s late): held **1.6–1.8 m** (main 2.0); tapped 1.9–2.4 m (main 2.0–3.1). The ticket's ≤ 2 m
  holds for the held thumb; the tapped again-at-1 s line is 2.1–2.4 (its window opens only once it is off the semi).
- `naive-players` 32/32; `naive-show` identical; `human-phone 150 --scheme=thumb`: no contact anywhere, jets-out gaps
  0/150 in every group. none identical (85.7). careful median **94 → 93.3** (median miss 3.5 → 2.4 m: they land nearer,
  but the Show's precision is full under 3.5 m, and the pitched approach costs 0.1–0.7 in the landing's tilt and wheel
  sync on 32 of 150). sloppy 150 → **139** inside the ring, median 93.3 → 92.3 (an up/down slide used to do nothing;
  now an overshot or upside-down read moves the touchdown).
- `daily-reach` (one thumb, n 150): mark-show **83 → 104**, gas-show 126 → 98 (pitching costs gas; over the floor).
- Known, left: `refA` is predict's ballistic-on-the-profile touchdown, 0.5–1.5 m off the flight's own at the moment
  it is read, so a held slide moves about 0.7–1.3 × X/6 m. The held thumb's window is short (≈1 s): the car passes the
  semi low, and shorter waits for room.
- Funnel numbers to move: `daily-done` on mark-show days; `run-landed` / `retry` per one-thumb `run`.
