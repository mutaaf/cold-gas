---
id: 0104
title: Flip phones play on the tall inner screen both ways and on the near-square cover screen
status: shipped
priority: P1
size: M
lens: platform
created: 2026-10-27
pr: 146
by: operator
---

## Why
A flip phone's inner screen is about 22:9 (≈ 360×748 upright with Chrome's bars, ≈ 800×300 sideways), and
its cover screen is near-square (≈ 360×380 on a Flip, 424×360 on a razr; estimates, 0102). Measured on main
with both touch schemes and both HUD states: sideways at 800×300 the full set's vehicle panel and dial sit
under the one-thumb pad or GO; on 360×380 the band, the dial and the vehicle panel sit under the stick,
the pad and the buttons in every phase; on 424×360 the phase tab sits under the pad (one-thumb) or BRAKE
and GO (two-thumb), and the full set's mission row under the top bar.

## What
- `scripts/audit-plan.mjs`: a flip set (both inner poses, both covers) at 3×, in `all`.
- `src/hud-mode.js` `fullFits`: no room for the full set under 320 px tall sideways or on a screen under
  440 px both ways: the compact line shows, MORE is put away, the choice kept (as 0103 closed sideways).
- `src/styles.css`, by size, not device: upright under 440 px tall the rail keeps three cells and the
  descent rises under it (tape shorter, figures scaled to stay 11 px); the title packs into rows of 44 px
  targets (wordmark on one line, the AI assist pill keeps its state); the judges' theatre under 330 px tall
  sideways or on the cover screen drops the raw stream (the receipt has it) and reads its counters in two
  columns (one at 424 wide), and upright on the cover screen the model card too (the caption names the
  model); the Rookie offer is its name alone there. Sideways under 720 px the two-thumb band stops at the
  slots' column (176 px) and the phase tab packs tighter.
- `scripts/title-audit.mjs --only=WxH,…`; `scripts/thumb-reach.mjs` with the flip sizes.
- (The ≤ 370 px-tall landscape full set stays for 320–370 px; at 300 px the full set doesn't fit.)

## Acceptance criteria
- [x] `npm run audit` green with the flip set (overlaps, offscreen, text ≥ 11 px, 4.5:1, theatre/pause 44 px targets).
- [x] The title audit is clean at the flip sizes.
- [x] Both schemes at the flip sizes: every control a ≥ 44 px target, none under a HUD box (e2e).
- [x] thumb-reach numbers for the flip sizes in the PR.
- [x] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
`tests/e2e/phone-flip.spec.js` (both schemes, three phases, the full set asked for, at the four sizes); `tests/e2e/theatre.spec.js` at 800×300 and 424×360 (and the fold's measured 594×368, 951×589); `tests/unit/foldables.test.js`; the audits.

## Out of scope
Flex Mode (0105). Whether Chrome can run on a given cover screen (a launcher matter).
