---
id: 0062
title: A crashed car finishes its crash: it brakes to rest under the real physics before the results
status: ready
priority: P0
size: M
lens: player-feel
created: 2026-10-21
pr:
by: operator
---

## Why
The operator: "once you crash the physics in the non driving modes should just use the right physics
to hit brakes and stuff".

In the stunt modes (the Show, the Wall, the Lineup, drills) a run ends on `contact` (2 s after touching
a parked vehicle), `flipped`, `stalled`, `runout`, `no-jump`, `settled`. `finish()` (src/sim/run.js)
froze the car there and freed the physics world at once, so a car still doing 10-38 m/s stopped dead
mid-slide or mid-tumble; main.js waited 1.4 s on that frozen pose and the replay ended on it.

## What
- src/sim/run.js: `armAftermath(run)` keeps the world past 'done'; `aftermathStep(run)` steps the same
  deterministic world with one fixed post-crash input: full brake through ABS (post-collision braking:
  VW's Multi-Collision Brake, Bosch's secondary-collision mitigation brake through the ESC hydraulics
  after the airbag controller sees a crash; held to a stop, as there is no driver to hand back to), no
  drive and no fan (an EV's crash sensor fires the high-voltage disconnect), valves shut (ESTIMATE:
  normally-closed), wheel straight. It ends when the car is at rest (speed < 0.3 m/s and spin
  < 0.3 rad/s for 0.5 s) or at a 6 s cap, records replay frames (parked bodies included), then frees the
  world. `aftermath(run)` runs it to the end (tests). Telemetry, the input log and the damage sensor
  are never touched: the card is closed at the end of the run, as before.
- src/main.js (run-end flow only): live runs and drills are armed; the card (and a drill's own card,
  which reads the car's speed) is taken when the run ends, the aftermath plays live (crash slow-mo and
  cut on top), and the results come up once the car is at rest and no sooner than the old beat (1.4 s;
  drills 0.5 s). The mission clock stops at the end of the run. Retry/Home dispose the world mid-aftermath.
- Not changed: src/worker (replays to 'done' and frees, as before), SIM_VERSION, the references.

## Acceptance criteria
- [x] `node scripts/ref-hash.mjs` unchanged: show fedae05c, wall bacb4720, lineup 8b2c2c9a
- [x] The scored card and telemetry are identical with and without the aftermath, and match `simulate`
      of the same log (the Worker's path) (tests/unit/aftermath.test.js)
- [x] A run ending at 38 m/s brakes to < 0.3 m/s within the cap (≈1 g, 3.9 s, 60 m), speed never rising;
      two runs of the same crash come to rest bit-identically (tests/unit/aftermath.test.js)
- [x] A Show crash (falls off the curl onto its roof at ≈12 m/s): the car's speed falls to ~0 on screen
      before the results appear, and the replay carries the aftermath frames (tests/e2e/aftermath.spec.js)
- [x] Retry during the aftermath starts a fresh run and frees the crashed world (tests/e2e/aftermath.spec.js)
- [x] `npm test` green, `node scripts/naive-players.mjs` 32/32, smoke/retry/lifecycle e2e green
- [x] Looks like a car that crashed and braked to a stop at 1280×720 and 390×844 (screenshots viewed)

## Test plan
tests/unit/aftermath.test.js (rest within the cap, determinism, card unchanged vs plain and Worker
replay); tests/e2e/aftermath.spec.js (speed trace to rest before results; Retry mid-aftermath).

## Out of scope
Free Drive and the Sandbox (their own loops); scoring anything that happens after the end.
