---
id: 0281
title: The car grips, slides and stops like a car (iPhone) - brakes inside the tyre's step, fade, balance, ABS on or off with flat spots, a handbrake, a drift assist for a thumb, skid marks on every set
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-11-17
pr: 429
by: operator
---

## Why
The owner, 2026-11-17: "we still need better driving realism like traction drift and brakes and skidding." 0225 and 0269
gave Free Drive and Roam a road car's chassis (DriveCar.swift: a Magic-Formula tyre on a friction ellipse, load
sensitivity, springs that move the load, traction and stability control, ABS, hot discs). What a probe of it found:
- **The brakes were stronger than their torque.** The wheel's spin was solved implicitly in its tyre, then braked after
  the solve, and the force on the car was taken at the braked slip while the wheel had only been turned by the tyre's
  force at the unbraked one. A stop drew ≈ 9.7 kN from a front tyre whose pad gave 1.6 kN·m (4.6 kN at the road): the car
  stopped on more than its brakes, so a hot pad could never fade, and the balance barely mattered.
- No brake fade, no way to move the balance, ABS only as a setting nobody could reach, nothing for a locked wheel.
- A handbrake existed in the chassis (`Vehicle.handbrake`) with nothing on the glass to pull it (0269's out of scope).
- A thumb on a slider couldn't hold a drift: the same slide a driver's hands hold (DriveDynamicsTests) spun with a thumb
  held still.
- Traction control capped the motors at 1.1 × the tyre's peak, so off the line the rears ran past it (0.54 slip).
- Skid marks were Free Drive's alone (World/Marks.swift); the scored run drew none, its smoke came from wheelspin only,
  and the hands felt nothing of a locked wheel.

## What
Runs on: the operator's Mac (Xcode).
- **The brake in the tyre's step** (DriveCar.swift): the wheel's spin is solved with the brake's torque inside the same
  implicit step as the tyre's force; the brake is friction (it opposes the spin up to its torque, holds a stopped wheel
  while the torque on it is under that). The pressure holds at the pedal instead of chattering round it.
- **Brakes:** a balance the player sets (front share, 60 % by default); pads that fade past 450 °C (to 40 % at 800 °C,
  from the disc temperature 0225 already kept); ABS on by default, counting each valve's dump as a pulse; off, the
  wheels lock, slide on the tyre's locked tail and grind a flat spot (full after ≈ 30 m locked, worn round over 4 km).
- **Handbrake:** the rears locked by the lever's own torque, the motors let go while it's up, stability control standing
  back for the pull and 0.5 s after. A HAND button on the drive's deck, beside the fan (FlightDeck.swift), with a heavy
  clack in the hand on the pull and a light one on the let-go.
- **Drift assist** (Settings → Driving, on by default; it does nothing with stability control On): in a slide the front
  wheels point along the front axle's own path and the thumb steers either side of it; the rears' torque is trimmed round
  a held angle (≈ 24°); past ≈ 34° a front brake takes the yaw rate down. With Sport, stability control becomes a net
  under it, catching only a slide past ≈ 40°.
- **Traction control** holds the tyre's peak (0.98 × instead of 1.1 ×, a stronger trim past its slip) and can be turned
  off on its own (Settings → Driving), as can ABS.
- **Skidding seen, heard and felt everywhere:** the scored run lays rubber on the set (RunSkids.swift, its own pass and
  shader Skid.metal, a capped ring of 4,096 quads; read from the track's wheels, never the sim); its tyre smoke follows a
  sideways slide as well as wheelspin; the squeal has three voices (a sideways howl, a locked wheel's lower scrub, a
  spinning wheel's chirp); the hands feel a locked wheel's judder, each ABS pulse, a flat spot thumping once a turn.
- All the tuning in DriveSpec with its source or ESTIMATE note. The scored car is untouched: the 52 run vectors stay
  bit-exact.

## Acceptance criteria
- [x] `make test` green, the 52 run vectors bit-exact.
- [x] DriveGripTests: 100-0 km/h on asphalt ABS on 30-40 m with many pulses, off 10-40 % further with the wheels locked and
      flat spots worn; each surface (asphalt, gravel, dirt, grass) within 0.9-1.3 × v²/2μg and in that order; the pads
      held at 800 °C stop ≥ 15 % further; the balance decides which axle locks (front: straight on, rear: the tail comes
      round); a handbrake pull swings the car (yaw rate past 60°/s) with the rears locked and the motors off; a thumb held
      still holds a drift with the assist (8-40° for 3.5 s) and spins without it; wheelspin off the line with traction
      control off (past 0.3 slip), held under 0.25 with it on; a drive replays to the same bits.
- [x] DriveCarTests and DriveDynamicsTests unchanged and green.
- [x] On the simulator ("ColdGas iPhone", `-mute`, the `-fd-drill` scripts): HAND on the deck above BRAKE, a handbrake
      turn and a held drift in Roam on the Show (the drift laid 309 quads of rubber on the slab), 100-0 stops with ABS on
      (32.0 m) and off (32.8 m on that stretch's loose ground, where a locked tyre keeps most of its grip), and the scored
      run laying marks from its own track (`-replay crash-show-carry5 -fx-log`: marks 2, `ref-show`: 8).

## After (DriveGripTests, `DRIVE_LOG=1`)
- The brake inside the step: a front tyre now gives what its pad's torque gives (2.5 kN·m → 7.1 kN at 800 °C; it gave
  9.7 kN from 1.6 kN·m before).
- 100-0 km/h, asphalt: ABS on 32.0 m in 2.29 s (236 pulses), off 38.9 m in 2.75 s, all four tyres worn flat. Front axle
  load 10.2 → 16.2 kN under the brakes, the rear 13.8 → 8.6 kN.
- By surface (ABS on): asphalt 32.0 m, gravel 49.4 m, dirt 53.3 m, grass 65.4 m (0.97-1.06 × v²/2μg).
- Fade: cold 32.0 m, discs at 300 °C 32.0 m, at 800 °C 41.3 m.
- Balance, half pedal, ABS off, the wheel turned: 70/30 yaws 2°, 30/70 swaps ends (167°).
- Handbrake at 16 m/s: rears locked, motors 0 N·m, 150°/s, 126° turned; without it 28°/s, 30°.
- A thumb's drift (handbrake in, steer 0.25 and 22 % throttle held): with the assist 12-29° for 3.5 s, settling at 24°;
  without it, a spin.
- Off the line, flat out: traction control off 22.8 slip and 5.7 m/s after 1 s; on 0.08 and 8.2 m/s.
- Two drives from the same start with the same inputs: the same bits.

## Test plan
`cd ios/Packages/ColdGasCore && DRIVE_LOG=1 swift test --no-parallel --filter "DriveGrip|DriveDynamics|DriveCar"` prints
every probe's numbers; `cd ios && make test`; `node scripts/check-backlog.mjs`. On the "ColdGas iPhone" simulator, `-mute`:
`-roam show` (the HAND button, Settings → Driving's ABS, traction control and drift assist), and a scored Show run.

## Out of scope
The scored car's physics (it stays the web's, bit for bit; only what's drawn, heard and felt from its state changes).
Tyre temperature and wear beyond the flat spot. Brake dive drawn on the scored car (its pose is the sim's). A keyboard or
pad handbrake.
