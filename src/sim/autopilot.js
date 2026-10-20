// The reference jump, flown closed-loop through the same physics the player uses: run up,
// burn lift off the lip, one clean 360° roll over the lineup, retro-level, settle on the pad.
// It powers the attract mode, the ?play=reveal replay and the physics regression tests.
import { newInput, bodyRates, up, G } from './vehicle.js';
import { RAMP, PAD } from './course.js';
import { v3 } from './m3.js';

export const REVEAL = { speed: 16.5, apex: 6.2, rolls: 1, rollBrake: 16 };

const rates = v3(), upv = v3();

export function createAutopilot(opts = {}) {
  const plan = { ...REVEAL, ...opts };
  const out = newInput();
  const st = { burnDone: false, rollDone: false };
  return function autopilot(run) {
    const c = run.car, t = run.t;
    Object.assign(out, newInput());
    out.assist = 1;
    const speed = Math.hypot(c.vel.x, c.vel.z);
    // Lane keeping: steer toward x = 0 with heading damping.
    out.steer = Math.max(-1, Math.min(1, -c.pos.x * 0.35 - c.vel.x * 0.25));

    if (run.phase === 'drive') {
      out.throttle = speed < plan.speed ? 1 : 0;
      out.brake = speed > plan.speed + 0.6 ? 0.4 : 0;
      // Start the lift burn just before the lip.
      if (c.pos.z > RAMP.z1 - 1.2) out.lift = 1;
      return out;
    }
    if (run.phase === 'air') {
      bodyRates(c, rates); up(c, upv);
      const vy = c.vel.y;
      const projectedApex = c.pos.y + (vy > 0 ? (vy * vy) / (2 * G) : 0);
      if (!st.burnDone) {
        if (projectedApex < plan.apex) out.lift = 1;
        else st.burnDone = true;
      }
      const target = plan.rolls * Math.PI * 2;
      const rolled = Math.abs(t.rollAccum);
      if (!st.rollDone && st.burnDone) {
        // Roll right; release when the flight computer's braking will stop it at 360.
        const remaining = target - rolled;
        const rate = Math.abs(rates.z);
        if (remaining <= (rate * rate) / (2 * plan.rollBrake) + 0.02) st.rollDone = true;
        else out.roll = 1;
      }
      if (st.rollDone) {
        out.level = 1;
        // Translate back over the centreline: a little roll stick tilts the lift vector.
        out.roll = Math.max(-0.25, Math.min(0.25, -(c.pos.x * 0.06 + c.vel.x * 0.16)));
        // Retro so the car stops near the pad.
        const h = c.pos.y - 0.6;
        const tFall = Math.max(0.3, h / Math.max(1, -vy));
        if (speed * tFall > PAD.z - c.pos.z + 2) out.retro = 1;
      }
      return out;
    }
    // Landed: brake to a stop on the pad.
    out.level = 0;
    out.brake = c.pos.z > PAD.z - 2 ? 1 : 0.35;
    return out;
  };
}
