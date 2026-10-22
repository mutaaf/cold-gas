---
id: 0066
title: One driving setting, Easy to Advanced, the same in every mode
status: ready
priority: P0
size: L
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
The operator: "we also need to allow the driving across all modes to be easier and more advanced".

Driving on the ground today is decided by the *flight* tier, and differs by mode:
- Free Drive and the Sandbox pass the flight tier to the hands, so Pro switches stability control off on a
  road and Advanced drives with a raw gamepad stick, no hands and no friction-ellipse traction control. A
  player who wants to fly Advanced has to drive Advanced; a newcomer can't make driving easier than Assist.
- There is no easier driving than Assist: a scripted naive keyboard driver who over-reads the grip (push
  1.25, 0.25 s reaction) leaves the Atlantic Road and Stelvio several times a minute.
- There is nothing more direct either: the stick and the keys always go through the rate-limited hands, the
  touch pedals are on/off, there is no handbrake and TC/ABS can't be changed.

## What
One driving setting, **Easy / Standard / Advanced**, remembered on this device, in the Controls sheet
(now on every device, reachable from the title, the pause sheet and Free Drive's pause sheet). It applies to
the ground in every mode: the Show/Wall/Lineup run-ups, drills, Free Drive's roads and the endless road, and
the Sandbox. It is a layer in the client (src/driving.js) that produces the same 23 input channels, so scored
runs stay verifiable by the frozen Worker with no SIM_VERSION change.

- **Easy**: speed-sensitive steering, a softer stick (bigger dead zone, more expo) and tilt through the hands,
  a gentle throttle (0.6 s pedal, held inside the friction ellipse while steering), a slide catch
  (counter-steer and a throttle cut past 5° of rear slip), and on a road a cornering-speed governor (brakes
  for the tightest bend over the braking distance ahead, from the road's curvature) and a lane-keeping nudge
  near the edge. Stability control on in unscored modes.
- **Standard**: today's Assist driving, unchanged bit for bit.
- **Advanced**: direct steering and pedals (no hands filter, a linear stick), analog pedals on touch (slide
  up the GO/BRAKE pad) and gamepad triggers; in unscored modes ESC off, traction control On / Sport / Off,
  ABS On / Off, a handbrake (H, gamepad B), and the fan is armed by hand (X, already the case in Free Drive).

Scored courses: the `assist`/`manual` channels on a scored run stay the flight tier's (any Assist tick makes
an Assist run, src/sim/run.js), so ESC/TC/ABS/handbrake are not changed there; the hands (steering, pedals,
Easy's slide catch) are, because they are ordinary logged inputs.

Default: Easy on a touch-first device with no saved choice (a phone player has a 2 cm stick and on/off
pedals), Standard elsewhere (a keyboard or pad player gets the feel the game was tuned and gated on).

## Acceptance criteria
- [ ] A Driving control labelled Easy / Standard / Advanced in the existing settings UI, keyboard-accessible
      (radiogroup, arrow keys), remembered per device (try/catch storage), reachable in Free Drive
- [ ] Default Easy on touch-first devices with no saved choice, Standard on desktop
- [ ] Standard is today's driving: hands output identical, `node scripts/ref-hash.mjs` unchanged, no SIM_VERSION bump
- [ ] `node scripts/drive-feel.mjs levels`: Easy has ≥ 50 % fewer spins + off-road excursions than today's Assist
      for the scripted naive driver, keyboard and touch stick, over the four roads
- [ ] Advanced reaches a higher cornering g and/or a faster segment time than Standard for the skilled scripted driver
- [ ] Unit tests (tests/unit/driving-levels.test.js) for the mapping; e2e (tests/e2e/driving-levels.spec.js):
      the setting persists and changes behaviour in Free Drive and on the Show run-up
- [ ] naive-players 32/32; lint, unit, build, the touched e2e specs green

## Test plan
tests/unit/driving-levels.test.js, tests/e2e/driving-levels.spec.js, `node scripts/drive-feel.mjs levels`,
ref-hash, naive-players.

## Out of scope
Changing the sim for scored runs (a new logged channel would need the frozen Worker). A touch handbrake button.
