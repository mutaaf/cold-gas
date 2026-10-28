---
id: 0104
title: Flip phones play on the tall inner screen both ways and on the near-square cover screen
status: in-progress
priority: P1
size: M
lens: platform
created: 2026-10-27
pr:
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
- `src/styles.css`: a layout for a very small screen (both sides ≤ 440 px) by size, not device: the
  controls keep their 44 px targets and reach; the band and the cue keep clear of them; the full set
  shows what fits. The ≤ 370 px-tall landscape arrangement extended to a 300 px one.
- `scripts/thumb-reach.mjs`: the flip sizes, both schemes.

## Acceptance criteria
- [ ] `npm run audit` green with the flip set (overlaps, offscreen, text ≥ 11 px, 4.5:1, theatre/pause 44 px targets).
- [ ] The title audit is clean at the flip sizes.
- [ ] Both schemes at the flip sizes: every control a ≥ 44 px target, none under a HUD box (e2e).
- [ ] thumb-reach numbers for the flip sizes in the PR.
- [ ] Works at 390×844 touch and 1280×720 keyboard (unchanged).

## Test plan
`tests/e2e/flip.spec.js` (both schemes, three phases, both HUD states at the four sizes); the audits.

## Out of scope
Flex Mode (0105). Whether Chrome can run on a given cover screen (a launcher matter).
