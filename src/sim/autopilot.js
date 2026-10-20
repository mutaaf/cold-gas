// The reference runs, flown closed-loop through the same physics the player uses. They power
// the attract mode, the ?play=reveal replay, the ghost, and the physics regression tests: if the
// autopilot can't land it, neither can a player, and CI fails.
import { newInput, bodyRates, up, forward, G } from './vehicle.js';
import { COURSES } from './courses.js';
import { SPEC } from './spec.js';
import { wallProgress } from './run.js';
import { v3 } from './m3.js';
import { dhypot } from './dmath.js';

// The reveal, as the livestream telemetry shows it (docs/REVEAL_RESEARCH.md): the Wall climbed at
// a crawl (≈4 m/s) on fan suction, hung inverted on the ledge, let go, rolled 180° in ≈1.1 s while
// falling, braked hard on the down-jets and landed ≈4.5 s after release. The kickflip lifted off
// flat ground at ≈7–8 m/s and peaked ≈7–8 m over the lineup.
export const REVEAL = {
  wall: { approach: 6, climb: 4, hang: 2.0, releaseAt: 0.97 },
  lineup: { speed: 7.5, apex: 5.0, rolls: 1, rollBrake: 14 },
  show: { carry: 8.5 },
};

const rates = v3(), upv = v3(), fwv = v3();

export function createAutopilot(courseId = 'show', opts = {}) {
  if (courseId === 'lineup') return lineupPilot({ ...REVEAL.lineup, ...opts });
  // The Show is the Wall with the row under the ledge: let go, and a short rear-jet burn carries
  // the car out over the row (`carry`, m/s along the run) before the roll-out and the descent.
  if (courseId === 'show') return wallPilot({ ...REVEAL.wall, ...REVEAL.show, ...opts }, 'show');
  return wallPilot({ ...REVEAL.wall, ...opts }, 'wall');
}

// Fly the lift vector toward the pad like a drone: a little roll moves you sideways, a little
// pitch moves you along the nose. Gentle near the ground, off in the last metre.
function steerToPad(c, pad, out, h) {
  forward(c, fwv);
  // Time to go: the governed descent (≈2.5 m/s) plus the hover-and-set-down at the end.
  const tGo = Math.max(1.5, h / 2.5 + 1.5);
  const dvz = (pad.z - c.pos.z) / tGo - c.vel.z, dvx = (pad.x - c.pos.x) / tGo - c.vel.x;
  const along = dvz * fwv.z + dvx * fwv.x;                  // + = toward the nose
  const side = dvz * fwv.x - dvx * fwv.z;                   // + = toward the car's right (−x)
  const k = h < 1 ? 0 : h < 2.5 ? 0.5 : 1;
  out.roll = k * Math.max(-0.45, Math.min(0.45, side * 0.24));
  out.pitch = k * Math.max(-0.55, Math.min(0.55, along * 0.2));
}

// Hold the centreline (inputs are driver-relative: + steers right, toward −x).
function laneKeep(c, out) { out.steer = Math.max(-1, Math.min(1, c.pos.x * 0.35 + c.vel.x * 0.25)); }

function wallPilot(plan, courseId) {
  const out = newInput();
  const st = { released: false, rolledOut: false, carried: !plan.carry };
  const pad = COURSES[courseId].pad;
  return function autopilot(run) {
    const c = run.car;
    Object.assign(out, newInput());
    out.assist = 1;
    const speed = dhypot(c.vel.x, c.vel.y, c.vel.z);
    if (run.phase === 'drive') {
      laneKeep(c, out);
      out.throttle = speed < plan.approach ? 1 : 0;
      out.brake = speed > plan.approach + 0.8 ? 0.3 : 0;
      out.fan = c.pos.z > -14 ? 1 : 0;           // spool the fan up before the foot of the ramp
      return out;
    }
    if (run.phase === 'ramp' && !st.released) {
      laneKeep(c, out);
      out.fan = 1;
      const prog = wallProgress(c.pos);
      if (prog >= plan.releaseAt) {
        // On the ledge: stop and hang upside down, then let go.
        out.brake = 1;
        st.hangT = (st.hangT || 0) + 1 / 240;
        if (st.hangT >= plan.hang) st.released = true;
        return out;
      }
      // Crawl governor up the deck: hold the climb speed against gravity.
      const err = plan.climb - speed;
      out.throttle = Math.max(0, Math.min(1, 0.45 + err * 0.3));
      out.brake = err < -1.5 ? Math.min(1, (-err - 1.5) * 0.4) : 0;
      return out;
    }
    // Released: fan off and gravity peels the car off the overhang. Then roll upright, level,
    // ease the sink rate, and use the front jets to stop on the pad.
    st.released = true;
    out.fan = 0;
    if (run.phase === 'landed') { out.brake = 1; return out; }
    up(c, upv);
    // The Show: carry out over the row on the rear jets (the nose points down the run, inverted).
    if (!st.carried) {
      if (-c.vel.z >= plan.carry) st.carried = true;
      else { out.thrust = 1; return out; }
    }
    // Roll out of the inversion (a barrel roll, as at the reveal), then let the computer level it.
    if (!st.rolledOut && run.car.grounded === 0) {
      if (upv.y > -0.15) st.rolledOut = true;
      else { out.roll = -1; out.pitch = 0; return out; }
    }
    out.level = run.car.grounded === 0 ? 1 : 0;
    if (upv.y > 0.5) steerToPad(c, pad, out, Math.max(0, c.pos.y - SPEC.comHeight));
    return out;
  };
}

function lineupPilot(plan) {
  const out = newInput();
  const st = { burnDone: false, rollDone: false };
  const course = COURSES.lineup, pad = course.pad;
  return function autopilot(run) {
    const c = run.car, t = run.t;
    Object.assign(out, newInput());
    out.assist = 1;
    const speed = dhypot(c.vel.x, c.vel.z);
    laneKeep(c, out);
    if (run.phase === 'drive') {
      out.throttle = speed < plan.speed ? 1 : 0;
      out.brake = speed > plan.speed + 0.6 ? 0.4 : 0;
      if (c.pos.z > course.lineupZ0 - 6.5) out.lift = 1;       // lift off flat ground before the cars
      return out;
    }
    if (run.phase === 'air') {
      bodyRates(c, rates); up(c, upv);
      const vy = c.vel.y;
      const projectedApex = c.pos.y + (vy > 0 ? (vy * vy) / (2 * G) : 0);
      if (!st.burnDone) { if (projectedApex < plan.apex) out.lift = 1; else st.burnDone = true; }
      const rolled = Math.abs(t.rollAccum), target = plan.rolls * Math.PI * 2;
      if (!st.rollDone && st.burnDone) {
        const remaining = target - rolled, rate = Math.abs(rates.z);
        if (remaining <= (rate * rate) / (2 * plan.rollBrake) + 0.02) st.rollDone = true;
        else out.roll = -1;
      }
      if (st.rollDone) {
        out.level = 1;
        steerToPad(c, pad, out, Math.max(0, c.pos.y - SPEC.comHeight));
      }
      return out;
    }
    out.brake = c.pos.z > course.pad.z - 2 ? 1 : 0.35;
    return out;
  };
}
