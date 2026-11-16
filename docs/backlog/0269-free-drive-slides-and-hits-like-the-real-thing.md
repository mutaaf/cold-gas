---
id: 0269
title: Free Drive and Roam slide and hit like the real thing (a Magic-Formula tyre, the car's own yaw inertia, real props), with a stability setting (iPhone)
status: in-progress
priority: P0
size: L
lens: player-feel
created: 2026-11-16
by: operator
---

## Why
The owner, after playing the TestFlight build (2026-11-16): "The drifting is not realistic. The physics and matter on all
objects, whether it's in Roam or anything, needs to be realistic." 0225's chassis (DriveCar.swift) and 0223/0227's loose
things were measured against real vehicle dynamics and real props with a harness (DriveProbe: slip angle, yaw rate, lateral
g and each tyre's forces through a handbrake turn, a power-oversteer exit, a lift-off, a Scandinavian flick and a held
drift). What it found (before):
- The tyre used one curve shape (C 1.65, a longitudinal one) for both directions: past its peak the lateral force fell to
  0.75 at 20° of slip and 0.63 at 45°. A sliding tyre keeps ≈ 0.9 of its grip; this one shed it, so once the rear let go it
  kept letting go. Every slide spun: handbrake turn at 16 m/s → 87° of body slip, 183°/s of yaw, 219° turned; power
  oversteer at 12 m/s → 251°/s; a flick at 22 m/s → 223°/s; a skilled driver (countersteer from 5° of slide, the throttle
  on the angle) held a drift in 1 of 4 tries, the rest spun past 85°.
- A grounded car's angular momentum was multiplied by 0.9985 every tick (≈ 30 % of any yaw rate gone a second): an
  invisible hand that holds slides back and then lets go.
- Yaw inertia 3,080 kg·m² at 2,447 kg on a 2.825 m wheelbase: a dynamic index of 0.65 (real cars 0.8–1.1): twitchy.
- A viscous −6·v N on every tyre at every speed (≈ 700 N at 30 m/s).
- Stability control was tied to the tier and traction control, with no setting.
- Loose things: the water-fill barrier was its empty shell (15 kg) and flew like a cone; the cone was a cylinder (it rolled
  away in a straight line forever) with a solid box's inertia (1.6× too hard to tip); every loose thing had 0.4/s of
  angular damping (floaty tumbles); a hit's knock in the hands was scaled by the thing's change of speed, so a 4 kg cone
  flicked away was felt as hard as a car hitting a wall.

## What
Runs on: the operator's Mac (Xcode).
- **The tyre** (DriveCar.swift, Free Drive and Roam only): a simplified Magic Formula per wheel, its own curve across
  (C 1.3, E 0.3: ≈ 0.9 of the peak far past it) and along (C 1.5, E 0.2: ≈ 0.75 locked or spinning), combined over the slip
  vector normalised by the peaks (the friction ellipse), with load sensitivity, peak slip growing with load and relaxation
  length as before. The peaks: 6.3° front, 6° rear at the nominal load.
- **Yaw:** the car's own inertia in a drive (3,800 kg·m², dynamic index 0.80), set on the engine's body too; no damping on
  the wheels but the tyres' and the air's; no viscous drag past a crawl.
- **Assists:** stability control On / Sport / Off (Settings → Driving), with traction control and vectoring following it;
  on touch (a slider or tilt) a light countersteer assist (the rack leans 35 % of the rear's slide angle into it).
- **Props:** the barrier water-filled (≈ 200 kg, HDPE μ 0.35, restitution 0.05); the cone a hull of its drawn shape with
  its two parts' inertia and a rubber base; damping as air drag; light things with CCD; a knock's strength from its
  impulse (mass × change of speed).
- **Tests** (DriveDynamicsTests, PropPhysicsTests): the tyre's curves, each manoeuvre, drift held and modulated by the
  throttle, lift-off and the flick, the inertia, each prop's behaviour, momentum exchange and rest.
- All the tuning in DriveSpec (and LooseKind for the props). The scored car is untouched: the 52 run vectors stay
  bit-exact.

## Acceptance criteria
- [ ] `make test` green, the 52 run vectors bit-exact.
- [ ] The harness's manoeuvres within real tolerances (DriveDynamicsTests), the props' (PropPhysicsTests).
- [ ] `make rules` green; the app builds.
- [ ] `make bench-freedrive`: the drive's physics step within +0.3 ms.

## Test plan
`cd ios/Packages/ColdGasCore && DRIVE_LOG=1 swift test --filter DriveDynamics` prints each manoeuvre's trace;
`cd ios && make test && make rules && make bench-freedrive`.

## Out of scope
The scored car (it stays the web's, bit for bit) and the Lineup's parked cars' bodies (shared with the scored runs: audited
here, unchanged). A handbrake control on touch. Tyre temperature and wear.
