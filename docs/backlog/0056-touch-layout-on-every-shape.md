---
id: 0056
title: Touch controls fit every screen shape, and moved slots are re-measured for reach
status: ready
priority: P1
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
- Touch controls on a landscape laptop or desktop (now shown after a finger tap, 0041 #67): at 1280×720 the
  one-thumb pad overlaps the attitude dial. There is no landscape touch layout for wide screens.
- 320×568 (iPad Slide Over, iPhone SE 1st gen) in the classic scheme: the C button (ledge LIFT, or GO
  before the row) can sit under a two-line cue. The audit only flies one-thumb on the Show.
- 0033 (#71) moved touch slots on short portrait and landscape screens; `scripts/thumb-reach.mjs` and
  `scripts/human-phone.mjs` weren't re-run, so how it plays is unmeasured.

## What
A touch layout for wide landscape screens; keep the cue clear of every slot in both schemes; extend
hud-audit to fly the classic scheme too. Re-run thumb-reach and human-phone (both schemes) and record
the numbers in the PR.

## Acceptance criteria
- [ ] hud-audit, both schemes, every viewport incl. 1280×720 with touch shown: 0 overlaps
- [ ] `node scripts/human-phone.mjs` landed rate ≥ 95 % for both schemes (AGENTS.md gate)
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse

## Test plan
Audit script extension; human-phone and thumb-reach numbers before/after in the PR.

## Out of scope
New control schemes.
