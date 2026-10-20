// The reference runs, flown closed-loop through the same physics the player uses. They power
// the attract mode, the ?play=reveal replay, the ghost, and the physics regression tests: if the
// autopilot can't land it, neither can a player, and CI fails.
import { newInput, bodyRates, up, forward, G } from './vehicle.js';
import { COURSES } from './courses.js';
import { SPEC } from './spec.js';
import { wallProgress } from './run.js';
import { v3 } from './m3.js';

export const REVEAL = {
  wall: { approach: 17, climb: 12, releaseAt: 0.96 },
  lineup: { speed: 16.5, apex: 6.2, rolls: 1, rollBrake: 16 },
};

const rates = v3(), upv = v3(), fwv = v3();

export function createAutopilot(courseId = 'wall', opts = {}) {
  return courseId === 'wall' ? wallPilot({ ...REVEAL.wall, ...opts }) : lineupPilot({ ...REVEAL.lineup, ...opts });
}

function laneKeep(c, out) { out.steer = Math.max(-1, Math.min(1, -c.pos.x * 0.35 - c.vel.x * 0.25)); }

function wallPilot(plan) {
  const out = newInput();
  const st = { released: false };
  const pad = COURSES.wall.pad;
  return function autopilot(run) {
    const c = run.car;
    Object.assign(out, newInput());
    out.assist = 1;
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
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
      // Speed governor up the deck: hold the climb speed against gravity.
      const err = plan.climb - speed;
      out.throttle = Math.max(0, Math.min(1, 0.55 + err * 0.25));
      out.brake = err < -3 ? Math.min(1, (-err - 3) * 0.2) : 0;
      if (wallProgress(c.pos) >= plan.releaseAt) st.released = true;
      return out;
    }
    // Released: fan off and gravity peels the car off the overhang. Then roll upright, level,
    // ease the sink rate, and use the front jets to stop on the pad.
    st.released = true;
    out.fan = 0;
    if (run.phase === 'landed') { out.brake = 1; return out; }
    up(c, upv);
    const clear = c.pos.y < 30 && run.car.grounded === 0;
    out.level = clear ? 1 : 0;
    if (upv.y > 0.5) {
      // Steer the fall onto the pad. The car may face either way after the flip, so pick the
      // jet pair that pushes toward where we need to be: rear jets push along the nose, front
      // jets against it.
      forward(c, fwv);
      const h = Math.max(0.3, c.pos.y - SPEC.comHeight);
      const tFall = Math.max(0.4, h / Math.max(1.2, -c.vel.y + 0.6));
      const wantVz = (pad.z - c.pos.z) / tFall, wantVx = (pad.x - c.pos.x) / tFall;
      const dvz = wantVz - c.vel.z, dvx = wantVx - c.vel.x;
      const along = dvz * fwv.z + dvx * fwv.x;                 // desired change along the nose
      if (along > 0.8) out.thrust = Math.min(1, along * 0.25);
      else if (along < -0.8) out.retro = Math.min(1, -along * 0.25);
      // Sideways: tilt the lift vector (a little roll) toward the target, in the car's own frame.
      const side = dvx * fwv.z - dvz * fwv.x;                   // + = toward the car's right
      out.roll = Math.max(-0.3, Math.min(0.3, side * 0.12));
    }
    return out;
  };
}

function lineupPilot(plan) {
  const out = newInput();
  const st = { burnDone: false, rollDone: false };
  const course = COURSES.lineup;
  return function autopilot(run) {
    const c = run.car, t = run.t;
    Object.assign(out, newInput());
    out.assist = 1;
    const speed = Math.hypot(c.vel.x, c.vel.z);
    laneKeep(c, out);
    if (run.phase === 'drive') {
      out.throttle = speed < plan.speed ? 1 : 0;
      out.brake = speed > plan.speed + 0.6 ? 0.4 : 0;
      if (c.pos.z > course.ramp.z1 - 1.2) out.lift = 1;
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
        else out.roll = 1;
      }
      if (st.rollDone) {
        out.level = 1;
        out.roll = Math.max(-0.25, Math.min(0.25, -(c.pos.x * 0.06 + c.vel.x * 0.16)));
        const h = c.pos.y - 0.6, tFall = Math.max(0.3, h / Math.max(1, -vy));
        if (speed * tFall > course.pad.z - c.pos.z + 2) out.retro = 1;
      }
      return out;
    }
    out.brake = c.pos.z > course.pad.z - 2 ? 1 : 0.35;
    return out;
  };
}
