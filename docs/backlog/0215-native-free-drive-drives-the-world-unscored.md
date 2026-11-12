---
id: 0215
title: Native Free Drive drives the world, unscored, from the title
status: in-progress
priority: P1
size: L
lens: platform
created: 2026-11-11
pr:
by: operator
---

## Why
The world (0214) needs the car on it. It should be the same Swift vehicle as the stunts, on ground that streams in
under it, with precision that holds tens of kilometres out, and the player needs a way in from the title.
docs/NATIVE-FREEDRIVE.md §5.

## What
Runs on: the operator's Mac (Xcode).
- A `drive` course: the Show's colliders, plus a streamer that builds what's near the car:
  - 16 m ground cells, as trimeshes of the exact carved ground;
  - solid trunks and boulders.
  The engine's origin floats in 512 m steps (`World.ox/oy/oz`, which were constants until now).
- The app's Free Drive mode:
  - the classic controls (`Controls`);
  - the web's chase and bumper cameras;
  - reset to the nearest road;
  - a HUD: speed, heading, distance from the apron;
  - a Free Drive card on the title, and `-freedrive` to open it directly.
- Nothing is scored: no log posted, no card, no medal.

## Acceptance criteria
- [ ] The 52 run vectors and every scored test stay bit-exact (`make test`).
- [ ] On the simulator the car drives from the apron onto a road and 5 km out without falling through.
- [ ] Back on the title, the scored courses fly as before.

## Test plan
`FreeDriveTests` (ColdGasPhysics):
- a car set on a streamed road 30 km out rests on its wheels;
- it drives 200 m without leaving the ground;
- the origin rebases under it without a jump.

The vectors stay as they are.

## Out of scope
AI drive, the cinema camera, the minimap (later), the Sandbox.
