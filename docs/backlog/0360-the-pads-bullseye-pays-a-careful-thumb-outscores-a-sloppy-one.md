---
id: 0360
title: The pad's 2 m bullseye pays, so a careful thumb clearly outscores a sloppy one
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-23
pr: 514
by: critic
---

## Why
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

## Built (0360, builder 2026-11-25)
`SHOW_PRECISION` (src/sim/judge.js; the Show and the Wall) is `[[2.05, 1], [2.15, 0.9], [4, 0.85], [5, 0.8], [7, 0.45],
[12, 0.15], [20, 0]]`: full marks only inside the painted 2 m ring (to 2.05 m, where the card's 0.1 m reading still says
"2.0 m", so a card that reads inside the ring is never marked down), 0.9 by 2.15 m, the 4 m ring 0.85, and from 5 m out
the old curve. The words name the ring as `SHOW_MARK_RING` (2). Scores only (no flight changes a bit); the Show and the Wall are `MARK_VERSION` 34 (src/sim/run.js), so an older
Show or Wall challenge or ghost is stale, as v31 (0182) made them. The Lineup is untouched (v33).

**Why a short ramp and not a gentle slope.** Every careful run "between 2 and 3.5 m" measured **2.1–2.2 m** (52 of 52): they
stop 10–20 cm outside the ring, and they outscore the inside runs on gas (efficiency 7.1 vs 6.0) and touchdown (landing
9.6 vs 9.1), not on the mark. A slope across 2–4 m cannot reach them (0.75 at 4 m still left the band at −1.0); only a
drop right after the line does.

Populations: `human-phone.mjs 300 --scheme=thumb`, telemetry dumped once (`--dump`) and re-scored; the Wall:
`scripts/lib/daily-reach.mjs` (n 150, seed 12345).

| | main | 0360 |
|---|---|---|
| careful: median inside 2 m − median 2–3.5 m | −1.0 (93.7 / 94.7) | **+1.7** (93.7 / 92.0) |
| careful median − sloppy median | 1.4 (93.7 − 92.3) | **4.0** (93.3 − 89.3) |
| careful p90 / sloppy p90 | 94.7 / 94.7 | 94.7 / 94.7 (met: ≥) |
| careful max / sloppy max | 95.3 / 95.7 | 95.3 / 95.7 |
| never slides: median (300/300 clean either way) | 88.3 | 87.3 |
| Show reference (1.5 m) | 97.3 | 97.3 (Precision 10) |
| Wall careful thumb: inside 2 m − 2–3.5 m | 0.0 (96.7 / 96.7) | **+2.7** (96.7 / 94.0) |
| Wall careful thumb median / Pro keys median | 96.7 / 70.0 | 93.7 / 69.7 |
| Wall reference (3.5 m off) | 97.7 | 94.3, still Perfect 10 and gold |
| Medals (bars kept): careful silver / gold | 100 % / 8 % | 100 % / 4 % |
| sloppy silver / gold | 76 % / 6 % | 48 % / 4 % |
| Wall careful gold (94) | 62 % | 43 % |

Daily (`scripts/daily-reach.mjs 150`, seed 12345, re-run on the final curve): every objective's reach is identical before and after (ninety-show
104/150, stick-wall 150/150, pro-wall 65/150, mark-show 104/150 at its own 3.5 m bar). Gates: naive-players 32/32,
naive-show 54/54, human-show 300 assist --cues=new 286/300 (95 %), ref-hash bit-identical (show 6b2cb98b 97.3, wall f1b9fab
97.7 → 94.3, lineup 4fc4af6b 91.7).

**Careful's p90 ≥ sloppy's p90 holds only as a tie.** Both populations' best runs land inside the ring, with the most gas
left. The mark can't tell them apart: sloppy's max is still 95.7 against careful's 95.3. Separating the very best runs is a
gas or touchdown question (efficiency, landing), not one the mark curve can answer.

**Follow-up (self-review, not done here: coach policy, out of scope).** The coach names the mark only once it costs
`MARK_POINTS` (3) of the total. A one-thumb touchdown 2.1–2.2 m off on the Show (≈ 1.4–3 points), or 2.1–3.2 m off on the
Wall (≈ 1–2.7 points), still reads "Clean · Try Pro", and NEXT RUN agrees with it ("try Pro"). Both are consistent with each
other, but the score shows points left on the mark there. Re-tune `MARK_POINTS` or the one-thumb clean line to the
bullseye, with the 0156 agreement test.

The words follow the scorer without a change of their own: `markRing` (keys, pads, two thumbs, Pro) reads
`SHOW_PRECISION[0][0]` and now says "within 2 m of the mark"; the coach names the mark once a miss costs `MARK_POINTS`
(3) of the total, which the new curve reaches from ≈ 2.2 m on the Show and ≈ 3.2 m on the Wall (the Show was ≈ 4.4 m), and NEXT
RUN follows the coach's first item.
The one-thumb clean line's own 3.5 m ring is untouched: it only shows when the coach found nothing worth naming, so "try
Pro" there agrees with What happened (tests/unit/thumb-mastery.test.js 0156).
