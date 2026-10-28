---
id: 0108
title: AI drive in Free Drive; the computer holds the road and the player drives the intent (and a reset lets go)
status: shipped
priority: P1
size: L
lens: player-feel
created: 2026-10-27
pr: 145
by: operator
---

## Why
The operator, 2026-10-27: **"driving still is uncontrollable; we need an AI-assisted mode in Free Drive."**

Diagnosed before building (`node scripts/drive-feel.mjs diag standard,easy`, new: the four baked roads and the
endless road, 60 s a run, push 1.25 and a 0.25 s reaction for the drivers who read the road):

| driver | Standard (the default) | Easy |
|---|---|---|
| reads the road, keys | 2.87 exits/km, 7.9 rail hits/km, 2 spins, first loss at 7.1 s (Atlantic; endless 8.3 s, Big Sur 23 s, Stelvio 29 s) | 0 |
| reads the road, thumb on the stick | 3.25 exits/km, 8.5 rails/km, 4 spins, first loss 7.1 s | 0 |
| reads the road, tilted phone | 3.38 exits/km, 7.8 rails/km, 8 spins, first loss 7.1 s | 0 |
| random keys (mash) | 22 exits/km, 86 rails/km, 13 spins, 1.1 s | 16 exits/km, 26 spins |
| → held all the way | 130 exits/km, 13 spins, 1.1 s | 65 exits/km, 25 spins |
| GO only, hands off | 6.4 exits/km, 17 spins, 2.8 s | 3.3 exits/km, 11 spins |

So a newcomer on the default leaves the road about every 330 m and hits a rail every 125 m, and loses the
car within 7 s on the Atlantic Road. Easy (0066) already keeps a driver who reads the road on it, but sits in the
Controls sheet behind Standard (0074) and does nothing for input that doesn't read the road.

On the real page (Playwright, 1280×720 keys and 390×844 touch), checking for bugs rather than difficulty:
- **Free Drive's reset didn't let go (bug, fixed in its own commit).** 0099 skipped Free Drive and the Sandbox:
  with ↑ and ← held through R the fresh car's first tick had steer −1 and throttle 1, back into the rail it had
  just been lifted off; with the keys let go just before R the wheel still came back at −0.83; on a phone GO
  held through Reset kept full throttle. Pause did let go (resetInput, and 0099's keyHolds held off the repeat).
- **30 fps:** the hands' rates are per 240 Hz tick, not per frame; a frame's ticks share one key state, so
  30 fps adds at most a frame (33 ms) of latency and doesn't change the steering rate. Not a cause.
- **The camera** (src/drive/camera.js chase) trails the heading and leans up to 55 % toward the velocity in
  a slide: it doesn't fight the player. Unchanged.
- **The stick's dead zone** on the ground (Standard: 15 % then a 0.3 expo, 0066) is not the problem: the thumb
  driver reading the road does about as well as keys (3.25 vs 2.87 exits/km).
- **Tilt** goes straight to the wheel after the hands in Standard (no speed sensitivity): the tilt driver spins
  4× as often as keys (8 vs 2) for the same exits. Left for Standard (0066 pins it bit for bit); AI drive reads
  tilt as intent, like a key or the stick.
- **0097's frame pacing on phones:** not measurable here (software GL); unverified on a real phone.

## What
- **`src/driving.js` AI drive (`ai`, over any level):** only where `ctx.road` is given, i.e. Free Drive's four
  roads and the endless road. Never a scored run (no road in the context: the level drives, bit for bit; the
  Worker never sees it) and not the Sandbox's arena (no road to follow). Pure, allocation-free (0 B/tick,
  0.37 µs; `npm run alloc:bench` has the row), dmath-free arithmetic only (+ − × ÷ √), writes only steer,
  throttle, brake and, on the unscored ground, a stock car (ESC on, TC on, ABS on, no handbrake).
  - Steering: pure pursuit on a point 4.5 m + 0.38 s ahead at the target offset (src/drive/pilot.js's
    geometry), the aim drifting to the outside of a hairpin; follows the sample it's on in a ±10 window (a
    switchback's other leg is never taken), the whole road only when lost; the travel direction from the
    heading with hysteresis; reversing aims behind.
  - Speed: the tightest bend over the braking distance ahead at 6.2 m/s² (Easy's governor), capped at
    140 km/h; braking for it with GO or without; 8 m/s while off the road finding it again.
  - Slides: counter-steer and a throttle cut past 3° of rear slip; throttle inside the friction ellipse.
  - Intent: GO is the pace (the hands' pedal ramp up to the safe speed); BRAKE slows and stops (and reverses at
    a standstill, as before). Steer past what the bend asks for moves the target across the road at 2.6 m/s
    (a lane change in about a second at speed; to the right-hand edge to pull over); let go, it settles into
    the nearest lane. A steer more than 0.5 past the bend's, held one way 0.8 s, hands over up to 70 % of the
    wheel over 0.8 s, taken back as the car heads for an edge. A sign change starts the count again (a
    zigzag never takes the wheel).
  - No lateral-g cap of its own: the rack already stops at the tyres' peak, and a kinematic cap ran the car
    wide (docs/LESSONS.md).
- **Setting:** `coldgas_driving.ai`, on for a player with no saved choice (and for a setting saved before
  0108). One tap on the HUD's **AI drive** switch (a 44 px `role="switch"` with its line: "Keeps you on the
  road · GO sets the pace · steer changes lane"), **O**, or a gamepad's **Y** on the ground. The switch sits up
  top with the chips on a phone (compact: left of Reset and Exit; full: under the dock, clear of the map;
  sideways: between the wordmark and the clock) and under the build dock on a desktop.
- **The offer:** with AI drive off, the second time the car is put back on the road within two minutes (R, the
  chip, or the watchdog after a flip), the cue says "Off the road again? Tap AI drive …" and the switch gets a
  ring, once a drive. The Show's Rookie mode waits for three crashed runs; a reset here comes every few
  seconds when a road is beating someone, so two is the signal, and once a drive is enough.
- **Name:** "AI assist" is the flight tier (the top bar's Assist chip, the coach, 0079), and it is on screen in
  Free Drive too (the jets fly there). This is the same idea on the road, so it shares "AI" but not the name:
  two "AI assist" controls on one screen doing different things would be one too many.
- **The reset bug:** Free Drive's placeAt / placePose and the Sandbox's place call `input.freshRun()`.
- No sim change, no SIM_VERSION bump; the Show, the Wall and the Lineup are untouched.

## Acceptance criteria
- [x] Every naive driver (mash, hold →, hold ←, zigzag, swerve, GO only; keys, and a thumb and a tilted phone
      for mash and swerve) on the four roads and three endless seeds, 60 s, ten seeds for the random ones:
      448 runs, 0 exits, 0 spins, 0 rail hits (`scripts/drive-feel.mjs diag`; unit:
      `tests/unit/ai-drive.test.js` on Stelvio, the Atlantic Road and the endless road)
- [x] Not a train: the same keyboard driver averages 106 km/h with AI drive against 100 on Standard over the
      five roads (Stelvio 75 vs 60, Transfăgărășan 75 vs 82, Big Sur 133 vs 126, Atlantic 130 vs 121, endless
      116 vs 113); naive drivers 96–108 km/h (Standard: 3–58)
- [x] Unit (pure): on by default and remembered; off = the level bit for bit; no road = the level bit for bit
      (a scored run, the Sandbox); only the ordinary channels and a stock car; deterministic; steer moves the
      target and never past the edge, let go settles into a lane; a tap never takes the wheel, a hard steer
      does, smoothly; GO capped by the safe speed with braking; BRAKE brakes; no allocation
- [x] e2e (`tests/e2e/wheel-ai-drive.spec.js`): 1280×720 keyboard on Stelvio and 390×844 touch on the Atlantic Road
      with AI drive on (the default), 40 s of seeded random input each (keys; a thumb thrown around the stick
      with GO held): the car's centre never past the edge line, upright, > 120 m covered; the switch toggles
      by tap and by O; R with ↑ ← held lets go
- [x] HUD audit on the Free Drive viewports (390×844, 844×390, 844×390 with insets, 768×1024, 820×1180,
      1180×820, 1280×720, 1920×1080; compact and full): 0 overlaps (the switch is in the audit's boxes now),
      0 text < 11 px, contrast ≥ 4.5:1
- [x] `node scripts/naive-players.mjs` 32/32 (the Show is untouched)
- [x] `npm run alloc:bench`: the Free Drive row 0 B/tick with keys and touch

## Test plan
`node scripts/drive-feel.mjs diag standard,easy,ai` before and after; the multi-seed sweep in the PR.
`tests/unit/ai-drive.test.js`, `tests/unit/driving-levels.test.js` (unchanged, green),
`tests/e2e/wheel-ai-drive.spec.js`, `tests/e2e/driving-levels.spec.js` (Free Drive's level test turns AI drive off
first: it measures the levels' own pedals and TC/ABS flags). Screenshots: `docs/shots/0108/`.

## Out of scope
- Real phones: the touch feel of the switch and of driving the intent with a thumb, iOS Safari's own
  pointercancel, tilt on a real gyro, and 0097's frame pacing on a phone's GPU (unverified here).
- Junctions: the baked roads and the endless road are single polylines; AI drive follows the one the car is on.
- Tilt in Standard still goes straight to the wheel (0066 pins Standard bit for bit).
- The Sandbox (no road to follow).
