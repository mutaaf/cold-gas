---
id: 0333
title: The car keeps its damage: glass cracks then shatters, lamps per corner, panels hang, arms bend and pull, the drive unit smokes and limps
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-11-19
pr: 461
by: operator
---

## Why
A crash's damage was dents, torn parts, crazed glass and lamps per end, all cosmetic. Nothing about it changed how the car
drove, and nothing hung, smoked or pulled.

## What
- `CarDamage` (pure, deterministic): every impact into per-zone deformation, the canopy's three states, each corner's lamp, the
  front and rear aero panels (on → hanging → off), each wheel's toe and camber, the drive unit's health (smoke from 0.6, limp
  from 0.4).
- In a drive the physics owns it (fed tick by tick from the sim's impacts) and the renderer draws the same (`Crash.adopt`); a
  scored run's replay keeps the crash's own (fed from its impacts: pixels only).
- DriveCar reads `toe` (a bent arm pulls the steering, a rear crabs the car) and `powerK` (limp). A reset restores it all.
- Drawn: the shattered canopy (an empty frame, 36 glass flakes, a crunch, a sharp hit in the hand), a hanging panel swinging
  on its last mount, bent wheels, smoke from the rear deck; the cue says what changed.

## Acceptance criteria
- [x] The thresholds: a lamp per corner, a panel hangs then goes, glass cracks then shatters, arms bend bounded (MatterTests)
- [x] Three 15 m/s crashes wreck the unit: smoke, then limp at 35 % (MatterTests)
- [x] A bent front arm pulls the car off its line hands-off, either way; a non-number is no toe (MatterTests)
- [x] A limping unit gains far less speed (MatterTests)
- [x] The same impacts give the same car (MatterTests)

## Test plan
`make test`; the simulator's `-fd-wreck` in each look.
