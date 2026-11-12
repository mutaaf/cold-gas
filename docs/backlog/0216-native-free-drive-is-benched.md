---
id: 0216
title: Native Free Drive is benched at 120 Hz (simulator, and the device command for the owner)
status: shipped
priority: P1
size: S
lens: performance
created: 2026-11-11
pr: 334
by: operator
---

## Why
NATIVE.md's bar is 120 Hz held on a Pro Max and a Duo. Free Drive adds a whole world, and it has to show that it fits.

## What
Runs on: the operator's Mac (Xcode). `-freedrive -bench` has the autopilot drive out from the apron for 10 s, then
prints `BENCH` with the frame times and the world's counters. The numbers go in docs/NATIVE-FREEDRIVE.md §8, along
with the device command for the owner to run on a phone they choose. An agent never runs it on the owner's phone.

## Acceptance criteria
- [ ] Simulator numbers recorded: frames, p95, CPU, tiles, triangles, instances.
- [ ] The device command is documented and runs without edits.

## Test plan
`make bench-freedrive` on the simulator prints a BENCH line.

## Out of scope
Running on the owner's phone.
