---
id: 0080
title: LIFT can't reach the sky; in the free modes the jets hop and hover near the ground
status: shipped
priority: P1
size: M
lens: player-feel
created: 2026-10-22
pr: 101
by: operator
---

## Why
The operator: "I shouldn't be able to float into space." Measured on main (Free Drive, Stelvio, 1280×720,
Space held from the road): one tank lifted the car from the road (≈1517 m) to y 1676 at t+10 s, falling at
19.6 m/s, so the peak was higher still; the gas ran out ≈20 s in. On the flat Sandbox apron the same tank
peaks at 174 m (Node, the same physics). With nitrogen refills (Free Drive's endless world and the Sandbox
hand them out; overpressure and the magnet hand gas back) the climb had no end: 6 km in 30 s with a refill
every 2 s. On a phone that reads as flying into the sky. A car with cold-gas jets should hop and hover near
the ground.

## What
`src/build/ceiling.js` (new), run by the build layer (`src/build/layer.js`) between sim ticks, the same
seam the power-ups use, so only the free modes have it: Free Drive's roads, the endless world and the
Sandbox. The Show, the Wall, the Lineup and the drills never construct the layer. `src/sim` is untouched,
`SIM_VERSION` stays 26 and the reference fingerprints are unchanged.

- **Ground-effect fade** (inputs, before each tick): LIFT, the four down-jets' valves (Advanced) and the
  share of BOOST that points up (all of it once the nose is 30° up) are scaled by `liftFade(h)`: full up to
  **3 m** above the surface under the car, smoothstep to **0 by 12 m**. The fade reads the height **0.6 s
  ahead** along the vertical speed, which damps it. A climb eases off before the band and a drop is
  cushioned, so there's no bounce at the top and the position is never clamped. Why these numbers: the
  down-jets make 78 kN on a 2,447 kg car (3.2 g), so the fade balances the weight at f ≈ 0.31, which
  is **≈8.7 m**: a hover two car lengths up, about the height a kicker jump reaches anyway. Full
  authority to 3 m keeps every hop, a lift over a parked car and a cushioned landing exactly as before.
- **Height source**: `surfaceHeight` (src/sim/world.js, the same exact Newton/bisect march on the
  distance field the engine uses) on the layer's composed course, so the road, terrain, bridges and every
  placed build piece count. It's sampled every 4 ticks (60 Hz) and follows the car's own height in
  between. It's allocation-free. (`car.floorGap` was no use: it's a 0.6 m fan ray.)
- **Envelope** (state, after each tick): whatever throws the car upward (a refill, a power-up, an
  explosion, a glitch) can coast no higher than **60 m**. Upward speed beyond √(2g(60 − h)) is shed at
  ≥ 2 g, so the car follows gravity's own curve to 60 m. A ramp jump is untouched below that: a
  1.5× kicker at 40 m/s peaks at 18 m.
- **Rescue**: ever **250 m** above the surface, the layer calls the mode's own reset (Free Drive's
  respawn, the Sandbox's start) with the cue "Too high for the jets · back on the road / to the start".
  It runs outside the tick loop.
- **Saying why**: the first time the ceiling takes held LIFT away, one cue: "Ground effect · the jets
  only lift you near the ground". While it's biting, the touch LIFT button's rim goes dashed and its
  held fill thins; the label keeps full ink.
- Free Drive's "stuck" watchdog (still, off its wheels, 3 s → respawn) no longer counts a car holding
  itself up on the jets. A hover isn't stuck.
- The AI quest brief (`schemaBrief`) tells the model the jets only lift near the ground (none from 12 m
  up), so anything higher than ~10 m has to be reached off a ramp.

## Acceptance criteria
- [x] `liftFade` is 1 to 3 m, 0 from 12 m, monotone and smooth (≤ 2 % per 5 cm), NaN-safe; `climbLimit`
      is gravity's speed to 60 m (`tests/unit/ceiling.test.js`).
- [x] A full tank of LIFT (Assist and Pro) peaks ≤ 12.5 m and hovers inside the band. With a refill every
      2 s it never gains height. A 20 m/s launch flies its 20.4 m ballistic arc. A 100 m/s launch tops
      out at ≤ 61 m with no rescue. A car 300 m up asks for one rescue (`tests/unit/ceiling.test.js`).
- [x] Free Drive, Stelvio, the real page: a tank of LIFT peaks at 9.6 m above the ground (9.6 above the
      road); with nitrogen granted every 2 s for 30 s, 9.8 m, still hovering at 8.6 m. Endless: 9.6 m
      with refills every 3 s. Sandbox: the hover peaks at 9.6 m and the LIFT button shows the ceiling; a
      1.5× kicker at 40 m/s still throws the car to 18.2 m, above the band (`tests/e2e/lift-ceiling.spec.js`).
- [x] No change to scored modes or `src/sim`: every unit test green, ref-hash fingerprints included,
      `SIM_VERSION` unchanged.

## Test plan
`tests/unit/ceiling.test.js` (new), `tests/e2e/lift-ceiling.spec.js` (new); drive, driving-levels,
endless, build, scenery and smoke e2e unchanged and green.

## Out of scope
Hovering across a valley or off a cliff: the fade is to the ground under the car, so out over a drop the
jets fade and the car falls. That's ground effect, and it's intended. A per-tier ceiling. The scored
events: their jets are the reveal's, untouched.
