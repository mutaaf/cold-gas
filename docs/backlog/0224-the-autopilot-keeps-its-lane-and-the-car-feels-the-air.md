---
id: 0224
title: Free Drive's autopilot keeps to its lane, and the drive's car feels downforce at speed
status: shipped
priority: P2
size: S
lens: player-feel
created: 2026-11-12
pr: 348
by: operator
---

## Why
The owner, 2026-11-12: "more realism for the car", and "an autopilot that keeps to its lane". The autopilot steered
for a point well ahead on its lane line (pure pursuit) and cut bends across the centre line. The drive's car had drag
but no downforce.

## What
Runs on: the operator's Mac (Xcode).
- **The autopilot** adds a Stanley term: the car's sideways offset from its lane's centre, abreast of it, steers it
  back (`atan(1.4·e / v)`), and the look-ahead is shorter (7 m + 0.45 s). It holds the right-hand lane through bends.
- **Downforce** in Free Drive and Roam only: ½ρ·ClA·v² along the car's own down, ClA 0.35 m² (ESTIMATE, sourced in
  `DriveStreamer`), applied through the drive's streamer hook. About 340 N at 40 m/s. Scored courses have no
  streamer, so they're untouched.

What the car already had, for the record: the scored car's model (Vehicle.swift, the web's) has load-sensitive tyres
with relaxation length, two rear motors at half power each, traction control, ABS, ESC, rigid-body weight transfer on
raycast suspension, and drag. Those are shared with the scored runs and stay bit-exact.

## Acceptance criteria
- [ ] `make test` green, run vectors bit-exact. New test: downforce goes with the square of the speed, and the tyres
      carry it.
- [ ] Simulator: the autopilot 3 km out stays in its lane (docs/shots/0224/).

## Test plan
`cd ios && make test && make rules`; on the simulator `-freedrive -fd-km 3 -fd-pilot 25` and watch it take bends in its lane.

## Out of scope
Torque vectoring between the rear motors and a drive-only tyre model. They'd mean drive-only branches in the scored
car's step, which is a bigger change than this ticket.
