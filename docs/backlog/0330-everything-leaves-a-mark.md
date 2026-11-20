---
id: 0330
title: Everything leaves a mark: the ground's matter, and the cause-and-effect map of the iPhone app
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-11-19
pr: 461
by: operator
---

## Why
The owner (2026-11-19) wants the environment's effect on the car and the car's on the environment considered end to end, every
damage and every effect, realistic in all three looks, built with the fewest re-renders. Nothing said what each pairing does,
what existed, and what didn't; and the drive's ground had no mud, snow drove as gravel, and ice and wet roads didn't exist.

## What
- docs/NATIVE-MATTER.md: the matrix (car, tyres, body, glass, lamps, props, every ground, water, the Lineup's row) with
  visual, physical, audio and haptic effects, what was there and what is now, the hook contract for LANDSCAPE and WATER, the
  three looks, the efficiency rules and the gaps.
- `GroundMatter` (ColdGasPhysics Matter.swift, pure): what's underfoot from the surface, its wetness and the cold (dirt or grass
  soaked is mud, water above the snow line is ice), its material, rut, roost, colour and coat. Snow and ice and mud and wet
  asphalt and a ford get their own materials (ESTIMATEs from friction tables); the streamer's snow is snow, not gravel.
- `DriveModel.gripK` (a wheel's grip over its ground's) for WATER's wet roads.

## Acceptance criteria
- [x] Soaked dirt and grass are mud, high water is ice; grip falls asphalt > wet > gravel > dirt > grass > mud > snow > ice (MatterTests)
- [x] The streamer gives snow its own material and high water ice (MatterTests)
- [x] Ice won't carry the car's throttle: under a third of asphalt's speed gained (MatterTests)
- [x] The scored path is unchanged: 52 run vectors bit-exact (`make test`)

## Test plan
`cd ios && make test` (MatterTests, RunVectorTests); `-freedrive -fd-wet 0.85` on the simulator drives a soaked field as mud.
