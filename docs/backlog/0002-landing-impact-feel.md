---
id: 0002
title: Make the touchdown land in the body — suspension squash, tyre puff, camera dip
status: ready
priority: P1
size: S
lens: player-feel
created: 2026-10-19
pr:
---

## Why
The landing is the moment the judges care about most, yet it reads the same at 0.8 and 4 m/s.
The player should *feel* a soft touchdown versus a heavy one before reading the scorecard.

## What
At touchdown, scale a short camera dip and FOV punch by sink rate, emit a ring of ground mist
from each wheel contact (src/render/plumes.js gets a `burst(pos, strength)`), and give the thud a
pitch and gain that depend on sink rate (src/audio.js). Honour `prefers-reduced-motion`.

## Acceptance criteria
- [ ] Soft (<1.5 m/s) and hard (>4 m/s) landings are visibly and audibly different
- [ ] Reduced motion disables the dip and the FOV punch
- [ ] No frame-time regression

## Test plan
Unit: the strength mapping function. E2E: the reveal run triggers exactly one landing burst.

## Out of scope
Damage modelling.
