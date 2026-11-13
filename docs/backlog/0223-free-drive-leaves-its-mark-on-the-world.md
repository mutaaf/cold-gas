---
id: 0223
title: In Free Drive and Roam the world takes the hits (cones, barriers and signs that fly, rubber, smoke and dust, felt in the lens and the hands)
status: shipped
priority: P1
size: M
lens: delight
created: 2026-11-12
pr: 347
by: operator
---

## Why
The owner, 2026-11-12: "enhance the physics and impact to environment". Free Drive's world was solid but nothing in it
moved except the parked row, and the tyres left nothing on the ground. A crash threw sparks and dents (0153's crash
port already reads the drive's impacts), but the lens and the hands didn't feel it.

## What
Runs on: the operator's Mac (Xcode).
- **Loose things** (ColdGasPhysics `Loose.swift`): cones (4.2 kg), empty water-fill barriers (15 kg) and A-frame signs
  (7.5 kg) as free rigid bodies with their real masses and lowered centres of mass. The car shoves, tips and rolls them
  with the engine's own impulses. Each set has its own layout (`looseSet`): a gate round the Show's pad, the Wall's
  run-up lined, the Lineup's lane and a barrier line behind its pad, and a slalom down the apron. The wheels' rays leave
  them out (`World.rayFilter`; `RAY_ALL` on every scored course), and a move of the origin carries them.
- **Rubber** (`SkidMarks`): a sliding or spinning tyre lays a strip on paving. The strips persist (a ring of 4,096 quads)
  and stay put as the origin floats.
- **Smoke, dust and spray** from the crash's puff pool: smoke off a hard slide on paving; grit thrown back and up off
  gravel, dirt, sand and grass, more with speed; spray from water.
- **Felt:** the crash's shake goes to Free Drive's camera (it went only to the stunt director's). Each impact the sim
  records is a haptic transient scaled by its speed. Rough ground and a slide are a rumble under them. A struck loose thing
  thuds in the sound and the hands, scaled by how hard.
- **Back on the road** makes the car whole again: dents out, lamps back (`Crash.repair`, which unlike `reset` doesn't
  replay the drive's earlier impacts).

## Acceptance criteria
- [ ] `make test` green, with the run vectors bit-exact. New tests: the loose things are mass-correct and come to rest
      standing; a car at 15 m/s sends a cone flying and barely slows; the scored courses have none.
- [ ] Simulator: a crash into the parked row, skid marks and smoke, dust off the road, in docs/shots/0223/.
- [ ] Bench before and after (`make bench-freedrive`).

## Test plan
`cd ios && make test && make rules && make bench-freedrive`; `-roam show` on the simulator.

## Out of scope
Fences and signposts out in the open world (the sets only, for now); breakable glass on the loose things.
