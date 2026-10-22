---
id: 0055
title: A run in Slide Over (320×568) has a compact HUD and touch layout that fits
status: ready
priority: P1
size: M
lens: accessibility
created: 2026-10-22
pr:
by: operator
---

## Why
Split from the operator's 0033 by the Builder (2026-10-22). 0033 made the title and top bar fit at
320×568 and cleared every other viewport, but a run there still fails `hud-audit` (320x568, 44
tablet frames): the portrait stack is laid out for ≥ 844 px of height, so the telemetry strip runs
under the one-thumb pad (≈ 12,000 px²), the cue lands on the strip and the pad, the descent's
LIMIT/GROUND row runs off the right edge, and the attitude dial touches the descent tape. In Free
Drive the stick overlaps BRAKE (3,840 px²), slot C (LIFT) sits on the chips, the Build dock and the
minimap, and the cue lands on the stick. At 320 px the classic stick, slot A, B and C physically
can't keep their phone positions, so this needs a layout of its own, placed by reach, not a nudge.
iPhone SE (375×667) and Safari with its toolbars (393×659) are the same short-portrait case.

## What
- `src/styles.css`, `src/drive/drive.css`, `src/build/build.css`: a `(pointer: coarse) and
  (orientation: portrait) and (max-height: 700px)` layout: a one-row (or unit-light) strip, the
  descent's meta row wrapped or trimmed, a smaller attitude dial, and touch slot sizes/positions for
  ≤ 360 px wide (stick, A, B, C) chosen with `scripts/thumb-reach.mjs`.
- `scripts/hud-audit.mjs`: add 375×667 to the phones.

## Acceptance criteria
- [ ] `hud-audit` reports 0 overlaps, 0 off screen, 0 texts < 11 px, 0 labels < 4.5:1 at 320×568 and 375×667 (Show and Free Drive)
- [ ] `scripts/thumb-reach.mjs` heatmap at 320×568 puts A in the easy zone, and no two controls touch
- [ ] Works at 390x844 touch and 1280x720 keyboard/mouse (no change there: hud-audit still clean)

## Test plan
Extend `tests/e2e/layout.spec.js`: at 320×568 touch, fly the Show to the carry and assert the strip,
the pad, the cue and the primary don't intersect; in Free Drive assert the stick, the pedals and
slot C don't intersect each other or the chips.

## Out of scope
The left-handed mirror in landscape (pre-existing: slot C lands on the primary, slot B on the strip's
left end); it needs a left-hand pass in the audit and its own ticket.
