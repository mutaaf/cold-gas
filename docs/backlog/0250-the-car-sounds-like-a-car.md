---
id: 0250
title: The iPhone app's sound is a real car's, a real world's and a real crash's
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-11-13
by: operator
---

## Why
The owner, 2026-11-13: "the sounds need to be way better". The native app's sound was the web's procedural sketch
(src/audio.js, 0154): one saw-and-sine whine on speed, a lowpassed noise for every tyre on every ground, one thud for
every hit. Free Drive now has a road car's chassis (0225), surfaces, a roadside that breaks (0227) and loose things
(0223); the sound said none of it.

## What
Runs on: the operator's Mac (Xcode, the simulator).
- **The car**: an electric drivetrain synthesised from its orders (two rear motors' electrical and slot orders, the
  reduction's gear mesh, beating against each other), the inverter's switching at low speed, a timbre that changes with
  load (drive, coast, regen and blended braking), tyres by surface (asphalt roar with tread, concrete slab joints, gravel
  grains, grass swish, spray), squeal from the tyres' slip past their peak, wind and a whistle rising with speed,
  suspension knocks from each corner's spring rate, ABS chatter.
- **Jets and stunts**: a pressure burst when a bank opens, a hiss tail that falls in pitch, the valves seating, the
  airtime whoosh, a landing scaled by sink rate (body, bottoming, a tyre's bark, rattle).
- **Impacts**: modal, by material (a car's shell, hollow plastic, timber, a ringing guard rail, a sign plate, stone,
  earth), scaled by impulse, with debris tails; stick-slip grinding.
- **World**: leaves in the wind, a breeze, crickets, birdsong round the listener (gulls on the coast), the stunt set's
  crowd and PA hum (Doppler-shifted, a cheer on a landing), pass-bys of trees, posts, rails and the parked row with their
  Doppler fall; reverb zones (open, forest, canyon, the set, under a deck).
- **Mix**: AVAudioEnvironmentNode for the world (HRTF on headphones, distance), a side-chain duck from impacts and the
  UI, a phone-speaker voicing, a peak limiter on the master; Settings gets Effects and Music sliders; while another
  app plays audio our music steps aside.
- Nothing reads back into the sim; every input is state the sim or the renderer already keeps.

## Acceptance criteria
- [x] `make test` green: the 52 run vectors bit-exact (no sim file changes).
- [x] Render callbacks allocation- and lock-free; their CPU measured (`-sound bench`, `-sound-cpu`).
- [x] Before/after captures from the simulator in docs/audio/0250/: a Free Drive, a stunt run, a crash.
- [x] 1.2.0 release notes and What's-new card.

## Test plan
`cd ios && make test`; on the simulator `-sound bench`, `-freedrive -fd-pilot 30 -sound-capture drive -sound-cpu`,
`-play -autopilot -course show -sound-capture stunt`, `-play -course show -script crash-show-carry5 -sound-capture crash`.

## Out of scope
The web game's audio (src/audio.js) and recorded sample libraries.
