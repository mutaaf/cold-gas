---
id: 0176
title: The Daily reach model acts on every read, and the mark and 90+ Show Dailies stay a stretch for a careful thumb
status: proposed
priority: P1
size: M
lens: engagement
created: 2026-11-09
pr:
by: builder
---

## Why
0173 fixed the modelled careful thumb in `scripts/human-phone.mjs`: a read is queued, so a thumb that re-reads faster
than it reacts still acts (`scripts/lib/read-react.mjs`). `scripts/lib/daily-reach.mjs`'s `flyThumb` has the same
overwritten-read loop (`want = …; aimAt = t + lagT` on every read). 0173 left it alone because fixing it breaks a gate
honestly. The gate is `tests/unit/daily-reach.test.js`, "the one-thumb mark, gas, skim and 90+ days still leave some
short". Once every careful thumb slides, two Show Dailies are met by every one of them.

`node scripts/daily-reach.mjs` (n 150, seed 12345), main `fb2bc3b` → with `createReadReact` in `flyThumb`:

| objective | before | after |
|---|---|---|
| mark-show (within 3.5 m) | 104/150 69 % | **150/150 100 %** |
| ninety-show (90+) | 104/150 69 % | **150/150 100 %** |
| gas-show (> 25 % gas) | 86/150 57 % | 56/150 37 % |
| soft-wall | 111/150 74 % | 143/150 95 % |
| skim-show | 97/150 65 % | 97/150 65 % |
| stick-wall, scratch-show | 100 % | 100 % |

`human-phone.mjs 150 --scheme=thumb --skill=careful`, after 0173: every thumb slides. Median miss is 2.1 m held from the
tap and 1.5 m lifted and pressed again. Clean scores run from 93.3 to 95.3. Sloppy thumbs: mark-show 65 %, ninety-show
75 %, gas-show 31 %. The old 69 % for both Dailies was the 41 thumbs that never slid (6 m, 85 points). A careful
slide meets both Dailies every time, so neither is a stretch for the population the gate models.

## What
1. In `flyThumb` (`scripts/lib/daily-reach.mjs`), use `createReadReact(lagT)` in place of `want`/`aimAt`, as
   `human-phone.mjs` does.
2. Decide the Show's mark and 90+ bars against the honest population, with the numbers, the same way 0135/0150 set them.
   Keep the lesson from 0156 in mind: `SHOW_PRECISION` already gives full marks inside 3.5 m, so a tighter mark bar must
   be one the score shows. A 90+ bar sits under every careful flight (93.3–95.3).
   Another option: model the thumb population as it is (some never slide, some are sloppy) instead of careful only.
   That is a model change, so say why with the funnel.
3. Re-check gas-show (37 % careful, 31 % sloppy) against the 30 % floor.

## Acceptance criteria
- [ ] `flyThumb` acts on every read (no overwritten pending read). `daily-reach.test.js` passes without loosening its assertions.
- [ ] `node scripts/daily-reach.mjs` before → after table in the PR. Every objective is ≥ 30 % and < 100 % for its population.
- [ ] Today's and tomorrow's Daily (src/daily.js's walk) are noted, so a streak isn't broken mid-day by a bar change.

## Test plan
`tests/unit/daily-reach.test.js` as it is, plus `tests/unit/daily.test.js` for any bar change.

## Out of scope
The sim, the pad, the sight, and `human-phone.mjs` (0173).
