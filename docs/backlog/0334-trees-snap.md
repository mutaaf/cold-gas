---
id: 0334
title: Trees snap: a fast enough car breaks a trunk at its foot and the tree comes down
status: shipped
priority: P2
size: M
lens: authenticity
created: 2026-11-19
pr: 999
by: operator
---

## Why
Every tree in Free Drive stopped the car dead at any speed, a 30 cm spruce and a 60 cm one alike.

## What
- Trunks are breakable items (Drive.swift): strength = the car's mass × a snap speed of 12.5 m/s × (r / 0.15)^1.5 (ESTIMATE:
  green wood's rupture at a bumper's height, the crush spreading the blow): ≈ 45 km/h for 30 cm, ≈ 128 km/h for 62 cm.
- Past it the trunk becomes a 640 kg body (`LooseKind.log`: trunk and crown) shoved at its foot and toppling away; the car keeps
  what went past. Its instance is hidden by place (`WorldView.setFelled`) until its cell is left and it stands again.
- A timber crack, a crush in the hand, a shake, splinters, bark and dust.

## Acceptance criteria
- [x] The snap speed grows with the trunk and is infinite for a non-number (TreeSnapTests)
- [x] A thin tree at 24 m/s snaps and falls away, the car slowed but going (TreeSnapTests)
- [x] A slow car (7 m/s) is stopped by it (TreeSnapTests)
- [x] Crash safety still holds at trunks (CrashSafetyTests)

## Test plan
`make test` (TreeSnapTests, CrashSafetyTests).
