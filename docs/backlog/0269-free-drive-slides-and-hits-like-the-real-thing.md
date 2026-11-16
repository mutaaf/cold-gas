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
- [x] `make test` green, the 52 run vectors bit-exact.
- [x] The harness's manoeuvres within real tolerances (DriveDynamicsTests, 14 tests), the props' (PropPhysicsTests, 7).
- [x] `make rules` green; the app builds (Release, simulator).
- [x] The drive's physics step within +0.3 ms: timed per tick in Release, before and after, inside the noise (≈ ±3 µs a
      tick; docs/NATIVE-FREEDRIVE.md §8). `make bench-freedrive` itself couldn't run: the Mac's simulator service was
      wedged by other work (every `simctl` call hung). Worth a run when it's free, and `make device-bench-freedrive` on the
      owner's phone.

## After (the harness's numbers)
- The lateral curve: 0.98 of its peak at 10°, 0.93 at 20°, 0.89 at 45° (was 0.90 / 0.75 / 0.63).
- A free-rolling wheel: |κ| under 0.005, its force steady to 2 N a tick (was ±0.1 and ±7 kN, every tick).
- Skidpad 1.13 g; the loaded front tyre's μ 1.26 against the unloaded one's 1.42 (load sensitivity).
- Step steer at 20 m/s: the yaw rate at 90 % 0.11 s after the wheels are half way there, 1 % overshoot.
- Weight transfer across the car at 1 g: 6,680 N against m·ay·h/t's 6,491.
- Handbrake turn at 16 m/s: 49° of slip, 131° turned, caught by the countersteer (was a spin: 87°, 219°).
- Power oversteer at 12 m/s, 40 % throttle (400 kW): Off spins (a 1 MW rear-drive car does), Sport 6.8°, On 2.9°.
- Lift-off at 1.2 g: yaw rate +13 % (26.7 → 30.1°/s), slip under 2°.
- Braking into a bend: 10.1° of slip; a flick first: 10.8° (dry tarmac: a road-tuned car shrugs most of a flick off).
- A held drift at 13–16 % throttle: 14–18° of mean slip for 3 s, never past 28°, the yaw rate the path's within 27 %;
  more throttle, more angle (4.9° → 14.0° → 18.0°). It used to spin in 3 of 4 tries.
- The touch countersteer assist: a 200 kW slide the thumb lets go of swaps ends without it (179°), is caught with it
  (14°, 102°).
- Props: a cone stands back up from a 0.8 N·s push at its tip, goes over from 5 N·s; flicked away at 17.8 m/s by a car
  at 15 m/s that loses 0.014 m/s. A barrier shoved at ≈ the car's speed, lifted 7 cm, sliding to a stop at 3.48 m/s²
  (μg 3.43); the car's momentum beyond coasting 1,211 N·s against the barrier's 1,044. Six barriers in a row, two
  stacked and a cone: asleep, nothing moved in 4 s. A parked 1,705 kg car shoved at 5.4 m/s (the bound 6.8), 1.1 m/s up,
  9° of tilt.

## Test plan
`cd ios/Packages/ColdGasCore && DRIVE_LOG=1 swift test --filter DriveDynamics` prints each manoeuvre's trace;
`cd ios && make test && make rules && make bench-freedrive`.

## Out of scope
The scored car (it stays the web's, bit for bit) and the Lineup's parked cars' bodies (shared with the scored runs: audited
here, unchanged). A handbrake control on touch. Tyre temperature and wear.
