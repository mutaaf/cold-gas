---
id: 0360
title: The pad's 2 m bullseye pays, so a careful thumb clearly outscores a sloppy one
status: proposed
priority: P1
size: M
lens: player-feel
created: 2026-11-23
pr:
by: critic
---

## Why

SCOUT 2026-11-25: held back to proposed to bring the ready queue to its cap of 10; the funnel's drops (no Post after a landing, no return) outrank it. Promote when room.
The focus's first item is "skill that shows in the score" on a phone. On the Show it barely shows once the thumb slides
at all. `node scripts/human-phone.mjs 300 --scheme=thumb --skill=<s> -v`, main `ac3dca4`
(docs/critique/2026-11-23-0400/human-phone-thumb-*.txt):

| One-thumb population (n 300) | Miss p10 / median / p90 | Median score | Max |
|---|---|---|---|
| never slides | 5.2 / 5.3 / 5.5 m | 88.3 | 89.3 |
| careful (onto the amber dot) | 0.8 / 1.3 / 2.2 m | 93.7 | 95.3 |
| sloppy (2–3× overshoot, half read it upside down) | 1.1 / 2.4 / 5.7 m | 92.3 | **95.7** |

- **Careful vs sloppy is only 1.4 points at the median, and the sloppy thumb's best beats the careful thumb's best.**
- **Inside the bullseye scores lower than outside it.** Careful runs inside the 2 m painted ring have a median of **93.7**
  (n 248). Careful runs between 2 and 3.5 m have **94.7** (n 52). Sloppy: 92.7 inside, 92.3 outside.
- **Cause:** `src/sim/judge.js:108`. `SHOW_PRECISION = [[3.5, 1], …]` gives full marks out to 3.5 m. The pad paints rings
  at 2 · 4 · 7 m (courses.js), so its innermost ring is decoration: a touchdown 3.4 m out, nearly on the 4 m ring, earns
  the same Precision as one dead on the cross. The Wall reads the same curve (0182).

A player who works the slide onto the dot and lands on the cross should see it in the number. Today the medal row
(Silver 90, Gold 95) can't tell them apart either.

## What
- Make Precision full only inside the 2 m painted ring (`course.pad.rings[0]`), falling across the 2–4 m band.
  The builder picks the curve and documents it with the populations, as 0121 and 0182 did.
- Re-check the Show's and the Wall's medal bars and the Daily's mark/90+ objectives against the new spread
  (`scripts/daily-reach.mjs`, 0176). Note what moved in the ticket.
- It changes scores, so bump `SIM_VERSION` (and `SURFACE_VERSION` for the wet sets), note it in the CHANGELOG, and
  regenerate the vectors (`npm run vectors`) in the same PR.

## Acceptance criteria
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=careful -v`: the median score of runs inside 2 m is ≥ 1.0 above the
      median of runs between 2 and 3.5 m (today −1.0).
- [ ] Careful median minus sloppy median is ≥ 3.0 points (today 1.4), and careful's p90 is ≥ sloppy's p90.
- [ ] The never-slides population still lands 300/300 clean. Its median doesn't rise.
- [ ] The Show reference (padMiss 1.5 m) still scores above every careful thumb, and stays ≥ 97 (`ref-hash`).
- [ ] The Wall: the same two population checks (`human-phone` has no Wall mode; use `daily-reach.mjs` populations) hold
      or improve. Report the numbers.
- [ ] Gates hold: `naive-players` 32/32, `naive-show` 54/54, `human-show 300 assist --cues=new` ≥ 95 %.
- [ ] Unit test in `tests/unit/judge*.test.js`: identical runs at 1.0 m and 3.0 m from the mark score Precision 10 and
      < 10 respectively.

## Test plan
Unit test on `scoreRun` with two synthetic Show telemetries differing only in `landZ`. Population numbers pasted in the
PR body (before → after).

## Out of scope
The coach's or the HUD's words about the rings (only the scorer's curve). The Lineup's own `band(padMiss, 16, 0.8)`.
