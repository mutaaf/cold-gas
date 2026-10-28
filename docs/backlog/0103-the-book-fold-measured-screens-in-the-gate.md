---
id: 0103
title: The book-style fold's measured screens are in the gate, in a tab and installed, with their insets
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-27
pr:
by: operator
---

## Why
0075 audited the fold at secondhand sizes. The operator's Device Hub measurements (0102) differ: open is
669×871 / 951×589 in a tab and 669×930 / 951×648 installed; closed sideways is 594×368 (left inset 84) one
way and 678×384 (bottom 34) the other, 678×445 installed; closed upright installed is 466×657 or 382×657.
At 594×368 today the compact band's phase tab runs under BRAKE in the two-thumb scheme and, with the full
set, the mission row runs under the top bar's buttons (measured on main). The insets pass through negative
values mid-fold (right −84, −282), and `--safe-*` takes them as they come: a negative inset pushes an
edge-anchored box past the glass. `screen.*` is 466×678 in every pose (nothing in the layout reads it;
`deviceKind` does, for the obs class only, and an iPhone UA answers first).

## What
- `scripts/audit-plan.mjs`: the fold set becomes the measured poses (tab and installed), each with its own
  insets and a 3× ratio; one table both audits and `scripts/thumb-reach.mjs` read; the shards rebalanced.
- `scripts/title-audit.mjs` reads its fold sizes from the plan (no second list to drift).
- `src/styles.css`: `--safe-*` clamped at 0; a narrow screen sideways (touch, under 720 px wide: the closed
  fold turned) stands the right thumb's slots in one column (B under A, C over it), narrows the stick, and
  fits the band, the phase tab and the cue line between them (from the left margin with one thumb); its
  title drops the big wordmark under 400 px tall (the brand names the game). The open-fold two-column query
  reaches 960 px tall (installed, open upright is 669×930).
- `src/hud-mode.js` `fullFits`: sideways under 720 px the full set has no room; the HUD shows the compact
  line and the handle is put away, the stored choice kept (it comes back unfolded or upright).
- `src/gfx-tier.js` `deviceKind`: the page's size before `screen` (stuck at the outer screen's 466×678).
- `tests/e2e/fold.spec.js` flies the measured sizes and transients (466×498, 867×589).
- `tests/unit/gfx-tier.test.js` / `hud-mode.test.js`: the measured UA is a phone in every pose; the HUD
  density follows the viewport (compact in every pose).
- AGENTS.md invariant 8 lists the fold's measured viewports.

## Acceptance criteria
- [x] `npm run audit` (all six shards) is green with the measured fold set, tab and installed, with their insets.
- [x] A negative inset never moves a box (e2e: forced −84 on the right keeps the top bar on the glass).
- [x] The fold e2e passes at 382×580 ⇄ 466×498 ⇄ 669×871 and 594×368 ⇄ 867×589 ⇄ 951×589.
- [x] The six shards stay balanced and inside CI's 40 min: the dearest shard's estimate rises 15 % (1122 → 1293 s; ten fold poses instead of five, and the title audit's 29 sizes), CI's dearest shard ran 24 min before.
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
Audit (fold set) before/after; `tests/e2e/fold.spec.js`; the unit tests above; screenshots in docs/shots/0103/.

## Out of scope
Flip phones (0104), hinges (0105), pausing on a fold (0106), the camera (0107).
