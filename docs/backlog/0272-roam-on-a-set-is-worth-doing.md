---
id: 0272
title: Roam on a set is worth doing: things to topple at their real masses, small unscored challenges, Fly one tap away (iPhone)
status: shipped
priority: P0
size: M
lens: engagement
created: 2026-11-17
pr:
by: operator
---

## Why
The owner (2026-11-17): the stunt and the roam on those sets need to be "100x better". A roam was the set and a few
cones: nothing to aim at and no reason to stay, and nothing pointing back at a scored run.

## What
Runs on: the operator's Mac (Xcode). Unscored: nothing here reaches a score, a log, the board or a medal.
- **The dressing comes loose** (0271's `dressingSet`, ColdGasPhysics `Loose.swift`): on a roam every tyre, drum, flight case,
  barrier section and the generator is a free rigid body at its real mass (ESTIMATE notes in `LooseKind.mass`: a bare tyre
  9.5 kg, an empty 200 L drum 18 kg, a case 90 kg, 2 m of precast barrier 950 kg, the generator 1,600 kg), tyres and drums as
  cylinders with their own inertia (a ring, a thin shell). Stacks are tyre on tyre, so they topple. Each sounds as it is
  (rubber thump, steel ring, timber, concrete) and buzzes by its impulse.
- **Challenges** (ColdGasPhysics `SetChallenges.swift`, pure; `World/RoamChallengesView.swift`): per set, a short list under
  Fly, a tick and the best beside each, kept on this device:
  - Show: leave the curl at its lip; fly the row end to end; land on the mark (≤ 2 m after ≥ 0.6 s in the air); topple six tyres.
  - Wall: the lip, the mark, the tyres.
  - Lineup: the row, the mark, the cone lane clean (inside it, no cone touched, out at 30 mph or more), the tyres.
  A done one (or a new best) is said in the drive's cue line and felt once; Fly then wears a hairline ring.
- **Stand the set up again** puts every loose thing back (it existed as `resetSet`, never reachable).
- On a roam the left column shows the list; the map button swaps it for the map and back.
- No timer, no streak, no reward, no nag: Fly is one tap above the list.

## Acceptance criteria
- [x] SetChallengesTests in SetDressingTests: each fires on its moment and not on the near-miss (rolling over the pad, a
      flight that lands in the row, flying beside the row, jumping off the floor by the curl, a touched cone, a slow exit).
- [x] A stack of four tyres is shoved over by the car at 10 m/s, which keeps > 7 m/s.
- [x] `make test` green, the 52 run vectors bit-exact.

## Out of scope
A board or medals for roam challenges (they stay unscored); new challenges in Free Drive's open world.
