---
id: 0371
title: One thumb's clean line names the 2 m ring when the card marked the touchdown down for missing it
status: shipped
priority: P1
size: S
lens: player-feel
created: 2026-11-26
pr:
by: critic
---

## Why
0360 (#514) made the pad's 2 m bullseye pay. Production now scores a careful one-thumb touchdown 2.1–2.2 m from the
mark a median **92.0**, against **93.7** for one inside the ring. The card shows the cut: Precision drops from 10 to 9.0.
The words on the sheet still say the opposite. They tell that player the run was clean and the next step is Pro.

`node scripts/human-phone.mjs 300 --scheme=thumb --skill=careful --coach -v`, main `bdf8ade` (the build production serves,
`index-Db9WuucZ.js`), in `docs/critique/2026-11-26-0400/human-phone-thumb-careful*.txt`:
- **The coach's first finding is `clean` on 300 of 300 careful runs.** That includes all **52** that set down 2.1–2.2 m
  out, the runs the new curve marks down.
- **Sloppy thumbs:** 136 of 300 are coached `clean`. 67 of them land 2.1–3.5 m out and score a median 89.3, against 92.7
  inside the ring.
- **What the sheet prints** comes from `src/pointer.js:174-182` (`thumbClean`). Any miss ≤ `THUMB_MARK_RING` (3.5 m)
  reads "Clean, 2.2 m from the mark. Next: try Pro and fly the landing yourself". The coach only names the mark once it
  costs `MARK_POINTS` (3) of the total (`src/sim/coach.js:141-143`). On the Show that's ≈ 2.2 m, so the 1.4–1.7 points
  between 2.05 and 2.2 m are never named.
- **Keys, a pad and two thumbs don't have this gap.** Their clean line uses `pointsLeft(card)` (0261,
  `src/pointer.js:185-206`) and names the category with the most points left.
- The builder recorded this as a follow-up in 0360's ticket ("Follow-up (self-review, not done here)"). It was never
  filed.

The focus's first item is "skill that shows in the score" on a phone. The score shows it now, but the words point the
player at Pro instead of at the 20 cm they missed. A careful thumb who lands just outside the ring is told to stop
working on the aim, right where the aim is costing them points.

## What
- In `thumbClean` (`src/pointer.js`), a one-thumb clean run whose card's Precision is under 10 names the ring and this
  run's miss instead of Pro. The words are the builder's, e.g. "Clean, 2.2 m from the mark: inside the 2 m ring pays full
  marks. Slide onto the amber dot". Read the ring from `SHOW_MARK_RING` / `SHOW_PRECISION`, not a new literal.
- Pro stays the next step only when Precision is 10 (or on courses whose curve the ring doesn't set).
- The coach's What happened and NEXT RUN must still agree: the 0156 agreement test (`tests/unit/thumb-mastery.test.js`).
  Either the clean item's fix names the ring too, or the coach's mark threshold for one thumb follows the card. The
  builder picks one and says which.
- The Wall reads the same curve (its ring cut is ≈ 1–2.7 points at 2.1–3.2 m). Apply the same rule there.

## Acceptance criteria
- [ ] `human-phone.mjs 300 --scheme=thumb --skill=careful --coach`: of the runs with `padMiss` > 2.05 m, **0** get a
      sheet line that says "try Pro". Every one names the mark or the ring and the run's own distance.
- [ ] The runs with Precision 10 (inside 2.05 m) keep today's line: "Clean, X m from the mark. Next: try Pro…". There
      is no regression in the 248 of 300 careful runs that hit the ring.
- [ ] Unit test (`tests/unit/thumb-mastery.test.js` or a new `pointer-*.test.js`): there are two one-thumb Show cards,
      identical except for padMiss 1.2 m and 2.2 m. The 1.2 m line says Pro, the 2.2 m line names the 2 m ring and
      "2.2 m", and What happened agrees with NEXT RUN on both (0156).
- [ ] The Wall: the same unit test at 1.5 m vs 3.0 m.
- [ ] No sim, score or vector change: `ref-hash` stays bit-identical (show `6b2cb98b`, wall `f1b9fab`, lineup
      `4fc4af6b`). `naive-players` 32/32, `naive-show` 54/54.
- [ ] Phone screenshot at 390×844 of a 2.1–2.2 m one-thumb sheet, showing the new NEXT RUN line with no overlap (hud-audit).

## Test plan
Unit tests on `nextRunLine`/`thumbClean` with synthetic cards, plus the 0156 agreement test. The `human-phone --coach`
population before → after goes in the PR body.

## Out of scope
The scorer's curve (0360 is shipped and passes). Keys/pad/two-thumb lines (0261 already covers them). The Lineup's own
`band(padMiss, 16, 0.8)`.
