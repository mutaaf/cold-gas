---
id: 0229
title: A crash into a pole never breaks the game (a wedged car starts again, the drive's safety nets)
status: shipped
priority: P0
size: M
lens: tech-health
created: 2026-11-13
pr: 366, 367
by: operator
---

## Why
A playtester on the TestFlight build (main at c9ce656), 2026-11-13: "Turning left and crashing into a pole caused the game to
break." They loved the crash and the haptics; they had to refresh to get going again.

Repro (the Swift sim and the JS sim alike): a scored run on Assist, full throttle with the stick held hard over from the start
(left or right; on the Lineup −0.6 after 1.5 s). The car curls into a set light on the Show or the Wall (fixturesOf, (±13, 20)…),
the Wall's steel, or a Lineup lamp post (≈ (12, −38)) and stops dead on its wheels: speed 0.01 m/s, hull touching, nothing NaN,
nothing sunk. No end of the run matches a car wedged before the jump (contact is for the parked row, stalled for the deck), so
the run sits there until its 90 s timeout: a frozen moment with nothing to do but quit.

Probed alongside and found sound: Free Drive's bend signs, guard rails, fences, trunks and boulders, and the Roam sets' poles,
at 6–60 m/s and ±40°, straight and turning: every state finite, penetrations transient (≤ 1.7 m for < 0.6 s at 60 m/s with CCD
off). Found and fixed while there: a drive recorded its impacts into the scored run's fixed 768-event buffer and never emptied
it, so after ≈ 25 s of scraping in a session the drive's crashes stopped making sparks, dents, sound or haptics.

## What
Runs on: the operator's Mac (Xcode) for the app; the web's half is #367 (src/wedge.js, src/main.js, src/drive/index.js, src/build/sandbox.js).
- `ColdGasPhysics/Sanity.swift`: `carFinite`, `deepestPenetration`, and `WedgeWatch` (stopped with the hull touching and going nowhere, within 0.6 m:
  a cue after 1 s, act after 2 s; a state that isn't a number acts at once).
- `Game.swift`: a live scored run in its drive phase that is wedged gets the cue "Stuck · again from the mark", then starts again
  from the mark (the frame clock's; the sim, the log and the score are untouched).
- `FreeDrive.swift`: back on the road when wedged with a pedal pressed for 1.5 s, sunk ≥ 30 cm for 1 s, or the car's state isn't
  a number (from the last pose that was; the set's mark if no road is found); the impact buffer recycled before it fills.
- `Drive.swift`: the streamer never converts a NaN or wild position to a cell index (a trap); a roadside break hands back no
  more than the car's own speed, and nothing for a degenerate contact.

## Acceptance criteria
- [x] `make test` green, the 52 run vectors bit-exact (no sim or scorer change, no SIM_VERSION bump).
- [x] CrashSafetyTests: the wedge repro on the Show, the Wall and the Lineup is seen within 2 s of the car stopping; no recorded
      run is ever taken for a wedge; every hard turn ends validly with its aftermath; Free Drive's roadside and trees and the
      Roam sets' poles at 8–60 m/s, turning and straight: finite, never sunk for a second; the safety nets themselves.
- [x] The app builds for the simulator.

## Test plan
`cd ios && make test` (CrashSafetyTests); the app built for the simulator.

## Out of scope
An end of the scored run for a wedge in the sim itself (it would change outcomes and need a SIM_VERSION bump: the app's retry
does the player's part without it). CCD on the drive's hull.
