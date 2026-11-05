---
id: 0165
title: On the Show, sliding up or down moves the touchdown along the run, as the sight draws it
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-11-05
pr:
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
