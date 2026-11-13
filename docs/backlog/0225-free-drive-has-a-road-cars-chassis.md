---
id: 0225
title: Free Drive and Roam drive a road car's chassis of their own (springs you can see, a friction-circle tyre, vectored rear motors, ABS, hot brakes), with real lamps, glossy paint and a plate that reads
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-11-13
pr: 350
by: operator
---

## Why
The owner, 2026-11-13: "we need the free drive to be 100x better … and also more realism for the car." Free Drive drove the
scored stunt car's model, which is tuned for one thing (a run up the Wall) and sits on 150 kN/m springs: the body never
visibly rolled, dived or squatted, the wheels barely moved, and the tyre's grip was shared between braking and cornering
only by a clamp. 0224 left torque vectoring and a drive-only tyre model out because they'd need drive-only branches in the
scored step. On screen the plate read upside down (docs/shots/0220/roam-wall.png), the brake lamps guessed at braking from
the car's deceleration, and in a roam the Show's red air washed the whole frame (docs/shots/0223/crash-into-the-row.png).

## What
Runs on: the operator's Mac (Xcode).
- **A chassis of its own** (ColdGasPhysics `DriveCar.swift`, `driveStep` + `DriveModel`), called by Free Drive and Roam
  instead of `step`. The scored `step` isn't touched (not a line): the 52 run vectors stay bit-exact. It keeps everything
  the world sees of the car (the engine body and hull, contacts and impacts, the fan, the jets and the flight computer) and
  replaces the chassis:
  - per-corner springs at ≈ 1.5 Hz ride (52 / 60 kN/m, ESTIMATE), asymmetric dampers, anti-roll bars, progressive bump
    stops, free lengths chosen so the car stands at the scored car's ride height; ≈ 1.8° of roll per g and ≈ 2° of dive
    under full brakes, every wheel's travel drawn;
  - a combined-slip tyre: one Magic-Formula-shaped curve over the slip vector normalised by its peaks (the friction
    circle), load sensitivity, a cornering stiffness that grows slower than the load, relaxation length, looser surfaces
    peaking later and flatter;
  - the two rear motors each on its own wheel: torque vectoring toward the yaw rate the steering asks for, per-wheel
    traction control (Sport: more slip; Off: the motors couple as a limited-slip differential), lift-off regen;
  - brakes 60/40 with a caliper pressure that builds and ABS that cycles it in three phases round the peak slip; each
    disc's temperature from the brake's work and the air's cooling;
  - downforce at the axles (0224's ClA), so speed trims the car.
- **Seen:** the aero disc's flat face is opened in a drive so the rotor and caliper show through the spokes, and a disc
  glows red to orange from ≈ 400 °C; the brake lamps follow the pedal; the paint gets a full glossy clear coat in a drive,
  reflecting the dusk itself off the set (Shaders.metal `duskEnv`) and the set's cube on it; ABS buzzes in the hand.
- **A cinema camera** beside chase and bumper: trackside spots ahead of the car, alternating sides, on a long lens.
- **The plate reads the right way** (all courses): three's canvas textures are flipped on upload; the exporter now writes
  `flipY` and the native loader honours it (the plate's texture is marked in the three stage files).
- **Roam on the Show and the Wall:** the red lights and the red air at 30 %, the LED strips dimmed to a red their core
  keeps (as the web's deck look does on the run-up).

## Acceptance criteria
- [x] `make test` green, the 52 run vectors bit-exact. New DriveCarTests: it stands at the scored ride height on its own
      springs; it rolls 1.2–3.5° per g onto the outside wheels; 100–0 km/h in 28–40 m, nose down 0.7–3°, ABS working, no
      wheel past a third slip; the tyre's lateral force falls with longitudinal slip; three hard stops heat the front discs
      past 200 °C and the air cools them; vectoring holds the yaw rate the steering asks for closer than without.
- [x] `make rules` green.
- [x] Simulator shots in docs/shots/0225/: the plate, the cinema camera on the set with hot discs, the car out in the world.
- [x] `make bench-freedrive` before and after (docs/NATIVE-FREEDRIVE.md §8).

## Test plan
`cd ios && make test && make rules && make bench-freedrive`; on the simulator `-roam show -fd-cam cinema -fd-hold 0.05,0.55,1
-fd-discs 650` and `-freedrive -fd-km 3 -fd-pilot 24 -fd-cam cinema`. `-fd-classic` (Debug) drives the old model for comparison.

## Out of scope
The scored car (it stays the web's, bit for bit). A gearbox (the car is direct drive). Tyre temperature and wear.
