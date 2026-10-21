// What the descent looks like from here: the numbers behind the landing HUD, the coach and the
// practice drills. Pure and allocation-free (fills an `out` object), read-only on the car: it never
// changes a run, so it is not part of the deterministic scoring and needs no SIM_VERSION.
//
// The physics is the governor's own (src/sim/vehicle.js): the four down-jets' trimmed lift at the
// feed pressure left at the end of the stop, times how upright the car is, minus gravity.
import { G, HOVER, LIFT_MAX, NOZZLES, massOf, feedPressure, pressureOf, gasToStop, brakePlan, profileVy, up, CAR } from './vehicle.js';
import { SPEC } from './spec.js';
import { v3, rotateInv } from './m3.js';
import { datan2, dhypot } from './dmath.js';

// Touchdown sink limits (m/s), from the judges' landing band (src/sim/judge.js: 0.9 is perfect,
// 6 scores zero) and the suspension: ≤1.5 is a soft landing, ≤3 is firm, above that it hurts.
export const SINK_SOFT = 1.5, SINK_FIRM = 3;
// A person needs about this long to see a cue and press a key.
export const REACTION = 0.3;

export const newPrediction = () => ({
  h: 0, sink: 0, upY: 1,
  aNow: 0, aEnd: 0, aMax: 0, aPlan: 0,
  stopDist: 0, brakeBy: 0, margin: 0, marginAhead: 0,
  profileSink: 0,          // the sink rate the LAND profile wants at this height
  status: 'green',         // green: on or under the profile · amber: fast but stoppable · red: not stoppable
  tGround: Infinity,       // free fall to the ground from here, s
  tLand: Infinity,         // to touchdown if you brake on the profile from here, s
  landX: 0, landZ: 0,      // where that touchdown is
  gas: 0, gasNeed: 0,      // kg: in the tanks, and what the stop (plus a short hover) costs
  rollOut: 0,              // signed roll to upright, rad (+ = roll right), 0 when upright
  pitchOut: 0,             // signed pitch to level, rad (+ = nose down, like the stick)
  touchSink: 0,            // the sink you'd touch down at if you started braking now, at full lift
});

const upv = v3();
// `h` is the height of the floor above whatever is below (the HUD measures it against the course).
export function predict(c, h, out) {
  const m = massOf(c);
  up(c, upv);
  const vy = c.vel.y, sink = Math.max(0, -vy);
  out.h = h; out.sink = sink; out.upY = upv.y;
  // The brake as it will be flown: roof up, all four down-jets, at the pressure left at the end.
  out.aNow = (LIFT_MAX * feedPressure(c)) / m - G;
  const used = gasToStop(c, m, vy);
  out.aEnd = (LIFT_MAX * pressureOf(c.air - used)) / Math.max(1, m - used) - G;
  // Over a full-lift stop the thrust falls from today's to the end's (the tanks blow down as they
  // empty), so the stop flies at about their mean.
  out.aMax = 0.5 * (out.aNow + Math.min(out.aNow, out.aEnd));
  out.aPlan = brakePlan(c, m);
  // Not roof-up yet? The roll-out comes first, and the car keeps falling while it turns (≈1 s for
  // the half-roll off the ledge at the stick's rate, with the spin-up and the stop).
  const tilt = datan2(dhypot(upv.x, upv.z), upv.y);
  // (A bank of up to ≈60° LAND levels while it brakes; past that the roll-out comes first.)
  const tLevel = tilt > 1.05 ? 0.15 + (tilt - 0.7) / 3.5 : 0;
  out.stopDist = stopFrom(sink, tLevel, out.aMax);
  // Brake by: the roll-out and the stop, plus one reaction time of falling, plus a metre to set down.
  out.brakeBy = out.stopDist + sink * REACTION + 1;
  out.margin = h - out.brakeBy;
  // The same, WARN seconds from now at today's vertical acceleration (free fall, or what the jets
  // are doing): when that's gone, it's time to act. Braking already, it stays clear.
  let lift = 0;
  for (let i = 0; i < NOZZLES.length; i++) lift += NOZZLES[i].max * c.throttles[i] * NOZZLES[i].dir.y;
  const aUp = (lift * feedPressure(c) * upv.y) / m - G;
  const sinkAhead = Math.max(0, sink - aUp * WARN), hAhead = h - sink * WARN + 0.5 * aUp * WARN * WARN;
  out.marginAhead = hAhead - (stopFrom(sinkAhead, tLevel, out.aMax) + sinkAhead * REACTION + 1);
  const levelDrop = sink * tLevel + 0.5 * G * tLevel * tLevel, sinkLevel = sink + G * tLevel;
  // The band's edge: the most sink you can carry here and still roll out (if you must), react and
  // stop at 70 % of a full-lift stop, down to a hover. (LAND's own plan flies well inside it.)
  out.profileSink = h > HOVER ? maxSink(h - HOVER, tLevel, Math.max(0.6, 0.7 * out.aMax)) : -profileVy(h, out.aPlan);
  // Touching down after braking from here at full lift (after the roll-out): v² = v² − 2·a·h.
  const v2 = sinkLevel * sinkLevel - 2 * Math.max(0, out.aMax) * Math.max(0, h - levelDrop - 0.3);
  out.touchSink = v2 > 0 ? Math.sqrt(v2) : 0;
  // Red: even full lift from now touches down harder than a firm landing. Amber: the stop has to
  // start within WARN s (a person needs the warning before the BRAKE line, not at it), or it would
  // touch down firm, or the sink is past the band. Green: on or under the band, with room.
  out.status = out.touchSink > SINK_FIRM ? 'red'
    : out.marginAhead < 0 || out.touchSink > SINK_SOFT || sink > out.profileSink + 0.5 ? 'amber' : 'green';
  // Free fall to the ground.
  out.tGround = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, h))) / G;
  // On the profile: fall until the profile catches the sink rate, then ride it down.
  out.tLand = profileTime(h, vy, out.aPlan);
  out.landX = c.pos.x + c.vel.x * out.tLand;
  out.landZ = c.pos.z + c.vel.z * out.tLand;
  out.gas = Math.max(0, c.air);
  out.gasNeed = Math.min(CAR.airMass, used + (m * G * 1.0) / (SPEC.ispFull * 0.6 * G));
  // Roll to upright in the body frame (driver-relative: + = to the right, like the stick).
  attitude(c, out);
  return out;
}

// Height a stop from `sink` takes: the roll-out (falling `tLevel` s), then braking at `a`.
const WARN = 0.6;
function stopFrom(sink, tLevel, a) {
  const drop = sink * tLevel + 0.5 * G * tLevel * tLevel, v = sink + G * tLevel;
  return drop + (v > 0 ? (a > 0.05 ? (v * v) / (2 * a) : Infinity) : 0);
}

// The largest sink from which a stop (roll-out, reaction, braking at `a`) still fits in `room` m.
function maxSink(room, tLevel, a) {
  let lo = 0, hi = 40;
  for (let i = 0; i < 18; i++) {
    const v = (lo + hi) / 2;
    if (stopFrom(v, tLevel, a) + v * REACTION <= room) lo = v; else hi = v;
  }
  return lo;
}

// Seconds to touchdown riding the LAND profile (a coarse 1-D integration: 1/30 s steps).
function profileTime(h, vy, aPlan) {
  let y = Math.max(0, h), v = vy, t = 0;
  const dt = 1 / 30;
  while (y > 0.05 && t < 20) {
    const want = profileVy(y, aPlan);
    v = v < want ? Math.min(want, v + aPlan * 2 * dt) : v - G * dt;
    if (v > -0.3) v = -0.3;
    y += v * dt; t += dt;
  }
  return t;
}

// The roll (about the car's long axis) and pitch that bring its roof up, signed like the stick:
// roll + = right, pitch + = nose down. World up in the body frame is u; roll correction is −u.x and
// pitch correction is +u.z (LESSONS: level-controller signs).
const wub = v3(), Y = v3(0, 1, 0);
function attitude(c, out) {
  rotateInv(wub, c.quat, Y);
  out.rollOut = -datan2(wub.x, wub.y);
  out.pitchOut = datan2(wub.z, wub.y > 0 ? wub.y : -wub.y);
  return out;
}
