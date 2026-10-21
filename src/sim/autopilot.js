// The reference runs, flown closed-loop through the same physics the player uses. They power
// the attract mode, the ?play=reveal replay, the ghost, and the physics regression tests: if the
// autopilot can't land it, neither can a player, and CI fails.
import { newInput, bodyRates, up, forward, G, computerValves, VALVE_KEYS, NOZZLES, landProfile } from './vehicle.js';
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
  // Run 2 (the G trace) hung under 1 s and moved forward off the lip during the roll, landing ≈8–12 m
  // out from the ramp's base (research §2.1.4): it rolls out along the ledge at 2.5 m/s and lets go.
  // (`hang`/`releaseAt: 0.93` stop it on the ledge instead, four wheels and the sealed floor on the
  // deck: the drills and run 1's hang.)
  wall: { approach: 6, climb: 4, hang: 2.0, releaseAt: 0.93, driveOff: true, driveSpeed: 2.5, driveFrom: 0.8, driveRelease: 0.96 },
  lineup: { speed: 7.5, apex: 5.0, rolls: 1, rollBrake: 14 },
  // The Show drives out along the ledge at the carry speed (driveSpeed falls back to `carry`) and lets go near the lip.
  show: { carry: 7.5, driveSpeed: undefined, driveOff: true, driveFrom: 0.8, driveRelease: 0.95 },
};

const rates = v3(), upv = v3(), fwv = v3();

export function createAutopilot(courseId = 'show', opts = {}) {
  const pilot = basePilot(courseId, opts);
  return opts.advanced ? byHand(pilot) : pilot;
}
function basePilot(courseId, opts) {
  if (courseId === 'lineup') return lineupPilot({ ...REVEAL.lineup, ...opts });
  // The Show is the Wall with the row under the ledge: drive out along the ledge and let go at the
  // carry speed (`carry`, m/s along the run; the rear jets top up any shortfall), then the roll-out
  // and the descent.
  if (courseId === 'show') return wallPilot({ ...REVEAL.wall, ...REVEAL.show, ...opts }, 'show');
  return wallPilot({ ...REVEAL.wall, ...opts }, 'wall');
}

// Advanced, flown by a perfect pair of hands: every tick, open each valve to what the flight
// computer would have opened, in 5 % steps (a thumb on a pressure pad, not a servo). The run is an
// Advanced run (manual, no computer in the sim): it proves the valves alone can fly the stunt, and
// it's the ghost and the regression test for per-thruster replays.
function byHand(pilot) {
  const valves = new Float64Array(NOZZLES.length), out = newInput();
  return function advancedPilot(run) {
    const inp = pilot(run);
    computerValves(run.car, inp, valves);
    Object.assign(out, inp);
    out.assist = 0; out.manual = 1;
    for (let i = 0; i < VALVE_KEYS.length; i++) out[VALVE_KEYS[i]] = Math.round(valves[i] * 20) / 20;
    return out;
  };
}

// Fly the lift vector toward the pad like a drone: a little roll moves you sideways, a little
// pitch moves you along the nose. Gentle near the ground, off in the last metre.
function steerToPad(c, pad, out, h, level = 2.5) {
  forward(c, fwv);
  // Time to go: the governed descent (≈2.5 m/s) plus the hover-and-set-down at the end.
  const tGo = Math.max(1.5, h / 2.5 + 1.5);
  const dvz = (pad.z - c.pos.z) / tGo - c.vel.z, dvx = (pad.x - c.pos.x) / tGo - c.vel.x;
  const along = dvz * fwv.z + dvx * fwv.x;                  // + = toward the nose
  const side = dvz * fwv.x - dvx * fwv.z;                   // + = toward the car's right (−x)
  // Stop steering for the last `level` metres so the car sets down level, four wheels together.
  const k = h < level ? 0 : h < level + 2 ? 0.5 : 1;
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
      // The Show: no hang. Over the top of the curl it drives out along the ledge to the carry
      // speed and lets go at the lip, so the car leaves already moving out over the row and falls
      // free (the reveal's 0.2–0.4 G off the lip) instead of being shoved by the rear jets.
      if (plan.driveOff && prog >= plan.driveFrom) {
        out.throttle = speed < (plan.driveSpeed ?? plan.carry) ? 1 : 0;
        if (prog >= plan.driveRelease) st.released = true;
        return out;
      }
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
    // LAND from the moment it lets go: the computer rolls it out of the inversion (a barrel roll, as
    // at the reveal), levels it and governs the descent.
    out.level = run.car.grounded === 0 ? 1 : 0;
    // Off the Wall the roll-out leaves the car banked and drifting: give it 4 m to level. The Show
    // carries forward speed onto the pad and levels in the last metre.
    // Steer for the pad once the roll-out is done and the down-jets are braking: tilting in free
    // fall moves nothing, and it would start the brake with its thrust aimed off the vertical.
    if (upv.y > 0.94) st.rolledOut = true;
    if (st.rolledOut && (c.vel.y < landProfile(c) + 0.5 || c.vel.y > -3)) steerToPad(c, pad, out, Math.max(0, c.pos.y - SPEC.comHeight), plan.carry ? 1 : 4);
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
