// THE GROUND-EFFECT CEILING (0080): in the free modes (Free Drive's roads, the endless world, the
// Sandbox) the jets hop and hover the car near the ground; they don't fly it into the sky. Like the
// power-ups (src/build/powerups.js) it acts between sim ticks, never inside src/sim, and the scored
// events (the Show, the Wall, the Lineup, the drills) never construct it.
//
//   Fade       LIFT, the four down-jets' valves (Advanced) and the share of BOOST that points up are
//              scaled by liftFade(h): full up to FULL m above the surface under the car, smoothly to
//              nothing by ZERO m. h looks LEAD s ahead along the vertical speed, so a climb eases
//              off before the band and a drop is cushioned: no bounce at the top, no clamp on the
//              position. Holding LIFT on a full tank the car settles near HOVER m.
//   Envelope   Anything else that throws the car upward (a refill, a power-up, an explosion, a glitch)
//              may coast no higher than TOP m: an upward speed beyond √(2g(TOP − h)) is shed at
//              ≥ 2 g (gravity's own curve to TOP, reached a little late). A ramp jump is untouched
//              until it would pass TOP (a 28° kicker at 45 m/s peaks near 23 m).
//   Rescue     Ever ABSURD m above the surface: the mode's own reset puts it back, with a cue.
//
// Why these numbers: the lift jets make 78 kN on a 2,447 kg car (3.2 g, src/sim/spec.js), so the
// fade crosses the weight where liftFade ≈ 0.31, ≈ 8.7 m: a hover at about two car lengths, the
// height a kicker's jump reaches anyway. Full to 3 m keeps every hop, the Lineup-style lift over a
// parked car (1.5–3.5 m) and a cushioned landing exactly as they were. 60 m is a tall kicker's jump
// with room to spare; 250 m is above any ballistic path the envelope allows.
import { surfaceHeight } from '../sim/world.js';
import { NOZZLE_SPEC, SPEC } from '../sim/spec.js';

export const CEILING = {
  FULL: 3,       // m above the surface: the jets at full authority below this
  ZERO: 12,      // m: no powered climb at all above this
  LEAD: 0.6,     // s: the fade reads the height this far ahead along the vertical speed (damping)
  HOVER: 9,      // m: where a full tank's LIFT balances the weight (documentation; not used)
  TOP: 60,       // m: no ballistic coast above this
  SHED: 2,       // g: the least an over-envelope climb is slowed by, on top of gravity
  ABSURD: 250,   // m: the car is put back by the mode's reset
  EVERY: 4,      // ticks between ground samples (60 Hz); in between h follows the car's own height
};
const G = 9.81;
const LIFT_VALVES = NOZZLE_SPEC.map((n, i) => (n.group === 'lift' ? i : -1)).filter((i) => i >= 0);
const REAR_VALVES = NOZZLE_SPEC.map((n, i) => (n.group === 'rear' ? i : -1)).filter((i) => i >= 0);
const VKEYS = NOZZLE_SPEC.map((_, i) => `v${i}`);
function valvesOpen(inp) {
  for (let k = 0; k < LIFT_VALVES.length; k++) if ((inp[VKEYS[LIFT_VALVES[k]]] || 0) > 0) return true;
  return false;
}

// The jets' authority at a height h (m) above the surface: 1 up to FULL, 0 from ZERO, smoothstep between.
export function liftFade(h, full = CEILING.FULL, zero = CEILING.ZERO) {
  if (!(h > full)) return 1;   // NaN (no surface found) counts as near: never strand a car's jets
  if (h >= zero) return 0;
  const s = (h - full) / (zero - full);
  return 1 - s * s * (3 - 2 * s);
}

// The most upward speed (m/s) a car h m up may carry and still coast no higher than TOP.
export function climbLimit(h, top = CEILING.TOP) {
  return h >= top ? 0 : Math.sqrt(2 * G * (top - h));
}

// One per free-mode layer. `sdf` is the world's ground with the placed pieces in it (the composed course).
export function createCeiling(getSdf) {
  const st = { tick: 0, groundY: 0, h: 0, fade: 1, biting: false, rescue: false, sampled: false };

  function sample(car) {
    const sdf = getSdf();
    if (!sdf) { st.groundY = -Infinity; return; }
    const y = surfaceHeight(sdf, car.pos.x, car.pos.z, car.pos.y);
    st.groundY = Number.isFinite(y) ? y : -Infinity;
    st.sampled = true;
  }
  // Height of the car's floor (its CoM less the CoM's ride height) over the surface under it.
  function height(car) {
    if (!st.sampled || st.tick++ % CEILING.EVERY === 0) sample(car);
    const h = car.pos.y - SPEC.comHeight - st.groundY;
    return Number.isFinite(h) ? h : 0;
  }

  // Before a sim tick: the jets' commands, faded with height.
  function preStep(car, inp) {
    const h = (st.h = height(car));
    const f = (st.fade = liftFade(h + car.vel.y * CEILING.LEAD));
    // Held LIFT the fade is taking away from (for the cue and the dimmed button).
    st.biting = f < 0.5 && ((inp.lift || 0) > 0 || (inp.manual && !inp.assist && valvesOpen(inp)));
    if (f >= 1) return;
    if (inp.lift) inp.lift *= f;
    // BOOST pushes along the car's nose: the share of it that climbs fades too (nose 30° up: all of it).
    const q = car.quat, fy = 2 * (q.y * q.z - q.w * q.x);
    const up = Math.min(1, Math.max(0, fy / 0.5)), kb = 1 - up * (1 - f);
    if (inp.thrust) inp.thrust *= kb;
    if (inp.manual && !inp.assist) {
      for (let k = 0; k < LIFT_VALVES.length; k++) { const key = VKEYS[LIFT_VALVES[k]]; if (inp[key]) inp[key] *= f; }
      for (let k = 0; k < REAR_VALVES.length; k++) { const key = VKEYS[REAR_VALVES[k]]; if (inp[key]) inp[key] *= kb; }
    }
  }

  // After a sim tick: the envelope and the rescue.
  function postStep(car, dt) {
    const h = car.pos.y - SPEC.comHeight - st.groundY;
    if (!Number.isFinite(h)) return;
    if (h > CEILING.ABSURD) { st.rescue = true; return; }
    const lim = climbLimit(h);
    const over = car.vel.y - lim;
    if (over > 0) car.vel.y -= Math.min(over, Math.max(CEILING.SHED * G, over * 4) * dt);
  }

  return {
    preStep, postStep,
    get height() { return st.h; }, get fade() { return st.fade; }, get biting() { return st.biting; },
    // The mode's reset is due (read and cleared once per rendered frame, outside the tick loop).
    takeRescue() { const r = st.rescue; st.rescue = false; return r; },
    reset() { st.tick = 0; st.sampled = false; st.biting = false; st.rescue = false; st.fade = 1; },
  };
}
