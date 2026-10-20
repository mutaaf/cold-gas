// One attempt, start line to settle: steps the vehicle, quantises and records the input (so the
// run can be re-simulated exactly), records replay frames, and measures everything the judges
// score. Pure and deterministic: the Worker runs this same file to verify a submitted run.
import { createVehicle, step, bodyRates, up, forward, worldPoint, newInput, DT, CAR, NOZZLES, HULL, massOf } from './vehicle.js';
import { COURSES, DEFAULT_COURSE, WALL, LINEUP, roofUnder, wallArcLength, showLocalX, showLocalZ } from './courses.js';
import { SPEC } from './spec.js';
import { v3 } from './m3.js';
import { datan2, dacos, dhypot } from './dmath.js';

// v5: driver-relative steer/roll/yaw, grip-limited steering, The Show; v4: sourced specs
// (docs/REVEAL_RESEARCH.md); v3: dmath; v2: physics v2
export const SIM_VERSION = 5;
export const FRAME_EVERY = 4;           // replay frame every 4 ticks = 60 Hz
export const MAX_TICKS = 240 * 120;     // 120 s hard cap (The Show runs both stunts)
export const SERVICE_TICKS = 240 * 2;  // The Show's nitrogen top-up, fast-forwarded

const KEYS = ['throttle', 'brake', 'steer', 'pitch', 'roll', 'yaw', 'lift', 'thrust', 'retro', 'level', 'fan', 'assist'];
export const INPUT_KEYS = KEYS;

// Quantise a raw input to the canonical integers both client and server use.
export function quantise(raw, out) {
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i];
    out[k] = Math.round(Math.max(-1, Math.min(1, raw[k] || 0)) * 100) / 100;
  }
  return out;
}
const pack = (q) => KEYS.map((k) => Math.round(q[k] * 100));
const unpack = (arr, out) => { for (let i = 0; i < KEYS.length; i++) out[KEYS[i]] = arr[i] / 100; return out; };

// Everything the judges score for one stunt. The Show keeps one per leg: the Wall's book is closed
// and hung on the Lineup's as `t.wall` when the second leg starts.
function newTelemetry(courseId) {
  return {
    course: courseId, leg: 0,
    launchSpeed: 0, launchTick: -1, airStartTick: -1, touchTick: -1, endTick: -1,
    apex: 0, apexZ: 0, rollAccum: 0, pitchAccum: 0, yawAccum: 0, offAxis: 0,
    minClearance: Infinity, contact: false, contactSpeed: 0, contactTick: -1,
    airAtLaunch: CAR.airMass, airAtTouch: 0, airEnd: 0,
    sink: 0, tiltDeg: 0, headingDeg: 0, lateral: 0, landZ: 0, landSpeed: 0,
    wheelTouch: [-1, -1, -1, -1], wheelSpreadMs: 0, maxCompression: 0, bottomOut: false,
    bodyStrike: false, flipped: false, settledUpright: false, maxSpeed: 0,
    thrustChanges: 0, endReason: '',
    zeroToSixty: null,
    // The Wall.
    rampEntrySpeed: 0, rampTick: -1, maxRampHeight: 0, progress: 0, invertedTime: 0, maxG: 0,
    launchHeight: 0, launchUpY: 1, launchProgress: 0, fellOff: false, landedOnRamp: false,
  };
}

export function createRun(courseId = DEFAULT_COURSE) {
  const course = COURSES[courseId] || COURSES[DEFAULT_COURSE];
  return {
    course: course.id,
    car: createVehicle(course.id),
    phase: 'drive',            // drive → ramp (wall only) → air → landed → done (Show: … → service → drive …)
    leg: 0,                    // The Show: 0 = the Wall, 1 = the Lineup
    legFrame: -1,              // replay frame where the Show's second leg starts
    tick: 0,
    inputLog: [],              // [tick, ...ints] whenever the quantised input changes
    lastPacked: '',
    flippedTicks: 0, airTicks: 0, offTicks: 0,
    frames: [],                // see recordFrame for the layout
    t: newTelemetry(course.id),
  };
}

const q = newInput();
const rates = v3(), upv = v3(), fw = v3(), p = v3();

// Replay frame: pos(3) quat(4) wheel compression(4) wheel spin(4) throttles(10) steer fan.
export const FRAME_SIZE = 7 + 4 + 4 + NOZZLES.length + 2;
function recordFrame(run) {
  const c = run.car;
  const f = new Float32Array(FRAME_SIZE);
  f[0] = c.pos.x; f[1] = c.pos.y; f[2] = c.pos.z;
  f[3] = c.quat.x; f[4] = c.quat.y; f[5] = c.quat.z; f[6] = c.quat.w;
  for (let i = 0; i < 4; i++) { f[7 + i] = c.wheels[i].compression; f[11 + i] = c.wheels[i].spin; }
  for (let i = 0; i < NOZZLES.length; i++) f[15 + i] = c.throttles[i];
  f[15 + NOZZLES.length] = c.steer;
  f[16 + NOZZLES.length] = c.fan;
  run.frames.push(f);
}

// Advance one tick with a raw input. Returns the run.
export function stepRun(run, raw) {
  if (run.phase === 'done') return run;
  quantise(raw, q);
  const packed = pack(q);
  const key = packed.join(',');
  if (key !== run.lastPacked) { run.inputLog.push([run.tick, ...packed]); run.lastPacked = key; }
  return advance(run, q);
}

// Progress along the Wall's profile (0 at the foot, 1 at the lip) for a point near the deck.
export function wallProgress(pos) {
  return wallArcLength(pos.z, pos.y) / WALL.length;
}

function advance(run, input) {
  const c = run.car, t = run.t;
  const show = run.course === 'show';
  // Which rules this leg runs by. The Show's second leg is the Lineup, turned onto its lane: its
  // checks run in Lineup-local coordinates (lx, lz).
  const wall = run.course === 'wall' || (show && run.leg === 0);
  const course = wall ? WALL : LINEUP;
  const local = show && !wall;
  const prevLift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  const prevVx = c.vel.x, prevVy = c.vel.y, prevVz = c.vel.z;
  step(c, input);
  run.tick++;
  if (run.tick % FRAME_EVERY === 0) recordFrame(run);

  const speed = dhypot(c.vel.x, c.vel.y, c.vel.z);
  t.maxSpeed = Math.max(t.maxSpeed, speed);
  if (t.zeroToSixty === null && dhypot(c.vel.x, c.vel.z) >= 26.8224) t.zeroToSixty = Math.round(run.tick * DT * 100) / 100;
  const lift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  if (Math.abs(lift - prevLift) > 0.08) t.thrustChanges++;
  // Felt acceleration in g (what the car's occupant would feel), the number the stunt is about.
  const ax = (c.vel.x - prevVx) / DT, ay = (c.vel.y - prevVy) / DT + 9.81, az = (c.vel.z - prevVz) / DT;
  if (run.tick > 30) t.maxG = Math.max(t.maxG, Math.min(25, dhypot(ax, ay, az) / 9.81));
  if (c.obstacleContact && !t.contact) { t.contact = true; t.contactSpeed = c.obstacleSpeed; t.contactTick = run.tick; }
  up(c, upv);
  const airborne = c.grounded === 0 && !c.hullContact;
  const lx = local ? showLocalX(c.pos.x) : c.pos.x, lz = local ? showLocalZ(c.pos.z) : c.pos.z;

  if (run.phase === 'drive') {
    if (wall) {
      if (c.onWall || (c.pos.z > 0.5 && c.pos.y > 1.2)) {
        run.phase = 'ramp'; t.rampTick = run.tick; t.rampEntrySpeed = speed;
      }
    } else {
      // The Lineup has no ramp: the car lifts off flat ground on thrust alone.
      // On the Show, only a lift-off on the lineup lane counts (not a bounce off the Wall's pad).
      run.airTicks = c.grounded === 0 ? run.airTicks + 1 : 0;
      if (run.airTicks > 12 && (!local || lz > -25)) {
        run.phase = 'air'; t.airStartTick = run.tick - 12;
        t.launchTick = t.airStartTick; t.launchSpeed = speed; t.airAtLaunch = c.air;
      }
    }
  } else if (run.phase === 'ramp') {
    if (c.grounded > 0) {
      t.maxRampHeight = Math.max(t.maxRampHeight, c.pos.y - SPEC.comHeight);
      t.progress = Math.max(t.progress, wallProgress(c.pos));
      if (upv.y < -0.3) t.invertedTime += DT;
    }
    if (Math.abs(c.pos.x) > WALL.width / 2 + 0.3 && c.pos.y > 1.5) t.fellOff = true;
    run.airTicks = airborne ? run.airTicks + 1 : 0;
    if (run.airTicks > 24) {
      run.phase = 'air';
      t.airStartTick = run.tick - 24;
      t.launchTick = t.airStartTick;
      t.launchHeight = c.pos.y; t.launchUpY = upv.y; t.launchProgress = t.progress; t.airAtLaunch = c.air;
      t.launchSpeed = speed;
    } else if (c.pos.y < SPEC.comHeight + 0.3 && c.pos.z < 0 && c.grounded > 0 && t.progress < 0.3) {
      run.phase = 'drive';   // rolled back off the foot of the ramp
    }
  } else if (run.phase === 'air') {
    bodyRates(c, rates);
    t.rollAccum += rates.z * DT;
    t.pitchAccum += rates.x * DT;
    t.yawAccum += rates.y * DT;
    t.offAxis += (Math.abs(rates.x) + Math.abs(rates.y)) * DT;
    if (c.pos.y > t.apex) { t.apex = c.pos.y; t.apexZ = c.pos.z; }
    if (!wall && lz > course.lineupZ0 - 3 && lz < course.lineupEnd + 3) {
      for (let i = 0; i < HULL.length; i++) {
        worldPoint(c, HULL[i], p);
        const roof = local ? roofUnder(showLocalX(p.x), showLocalZ(p.z)) : roofUnder(p.x, p.z);
        if (roof > -Infinity) t.minClearance = Math.min(t.minClearance, p.y - roof);
      }
    }
    const minAir = wall ? 48 : 36;
    if ((c.grounded > 0 || c.hullGround) && run.tick - t.airStartTick > minAir) {
      run.phase = 'landed';
      t.touchTick = run.tick;
      t.sink = Math.max(0, -c.vel.y);
      forward(c, fw);
      t.tiltDeg = dacos(Math.max(-1, Math.min(1, upv.y))) * 180 / Math.PI;
      // Heading error against the run direction (the Wall sends you back the way you came, and
      // the Show's Lineup lane runs the same way).
      const back = wall || local;
      t.headingDeg = datan2(back ? -fw.x : fw.x, back ? -fw.z : fw.z) * 180 / Math.PI;
      t.lateral = lx - course.pad.x;
      t.landZ = lz;
      t.landSpeed = dhypot(c.vel.x, c.vel.z);
      t.airAtTouch = c.air;
      if (wall && c.pos.z > -1 && c.pos.y > 1.2) t.landedOnRamp = true;
    } else if (!wall && c.grounded > 0 && run.tick - t.airStartTick <= 36) {
      run.phase = 'drive'; run.airTicks = 0;
      t.rollAccum = 0; t.pitchAccum = 0; t.yawAccum = 0; t.offAxis = 0; t.apex = 0;
    }
  }

  if (run.phase === 'landed') {
    const since = run.tick - t.touchTick;
    if (since <= 72) {
      for (let i = 0; i < 4; i++) {
        if (t.wheelTouch[i] < 0 && c.wheels[i].contact) t.wheelTouch[i] = run.tick;
        t.maxCompression = Math.max(t.maxCompression, c.wheels[i].compression);
      }
      if (c.hullContact && !c.obstacleContact) t.bodyStrike = true;
    }
  }

  // Flip detection: upside down while touching the ground (on the deck that's the point).
  const onDeck = wall && run.phase === 'ramp';
  if (!onDeck && upv.y < 0.25 && (c.grounded > 0 || c.hullContact) && run.phase !== 'air') run.flippedTicks++;
  else run.flippedTicks = 0;
  if (run.flippedTicks > 120) t.flipped = true;
  run.offTicks = onDeck && speed < 0.5 ? run.offTicks + 1 : 0;

  // The Show: after a clean Wall landing, stop on the pad and the crew tops the nitrogen back up
  // (the reveal flew each stunt on a fresh fill; the sim fast-forwards the fill to SERVICE_TICKS).
  // Then the Lineup leg starts from rest.
  if (show && run.leg === 0) {
    if (run.phase === 'landed' && run.tick - t.touchTick >= 96 && upv.y > 0.8 && speed < 0.5 && !t.flipped && !t.landedOnRamp) {
      closeBook(run, t, 'next');
      run.phase = 'service'; run.serviceTicks = 0; run.serviceFrom = c.air;
      return run;
    }
    if (run.phase === 'service') {
      if (speed < 0.5) run.serviceTicks++;
      c.air = run.serviceFrom + (CAR.airMass - run.serviceFrom) * Math.min(1, run.serviceTicks / SERVICE_TICKS);
      if (run.serviceTicks >= SERVICE_TICKS) startLineupLeg(run);
      return run;
    }
  }

  let end = '';
  if (t.flipped) end = 'flipped';
  else if (t.contact && run.tick - t.contactTick > 480) end = 'contact';
  else if (run.phase === 'landed' && (show && run.leg === 0 ? run.tick - t.touchTick > 240 * 10 : speed < 1.2 || run.tick - t.touchTick > 240 * 5)) end = 'settled';
  else if (c.pos.z > COURSES[run.course].runout.zMax || c.pos.z < COURSES[run.course].runout.zMin) end = 'runout';
  else if (run.offTicks > 240 * 6) end = 'stalled';
  else if (run.tick >= MAX_TICKS) end = 'timeout';
  else if (!wall && run.phase === 'drive' && lz > course.lineupEnd + 4 && c.grounded > 0) end = 'no-jump';
  else if (!wall && run.phase === 'drive' && c.obstacleContact) end = 'no-jump';
  if (end) finish(run, end);
  return run;
}

function finish(run, reason) {
  run.phase = 'done';
  closeBook(run, run.t, reason);
}

// Final bookkeeping for one stunt's telemetry.
function closeBook(run, t, reason) {
  const c = run.car;
  t.endTick = run.tick;
  t.endReason = reason;
  t.airEnd = c.air;
  up(c, upv);
  t.settledUpright = upv.y > 0.8 && !t.flipped;
  if (t.wheelTouch.every((x) => x >= 0)) t.wheelSpreadMs = (Math.max(...t.wheelTouch) - Math.min(...t.wheelTouch)) * DT * 1000;
  else t.wheelSpreadMs = 1000;
  t.bottomOut = t.maxCompression > CAR.restLen - CAR.mountToCentre + CAR.maxTravel + 0.02;
  t.mass = massOf(c);
}

// The Show, leg 2: the Wall's book (closed at the service stop) hangs on the Lineup's.
function startLineupLeg(run) {
  const w = run.t;
  const t = newTelemetry('show');
  t.leg = 1; t.wall = w;
  t.zeroToSixty = w.zeroToSixty; t.maxSpeed = w.maxSpeed; t.maxG = w.maxG;
  run.t = t;
  run.leg = 1;
  run.legFrame = run.frames.length;
  run.phase = 'drive';
  run.airTicks = 0; run.flippedTicks = 0;
}

// Re-simulate a run from its input log alone (replay, server verification).
export function simulate(inputLog, courseId = DEFAULT_COURSE, maxTicks = MAX_TICKS) {
  const run = createRun(courseId);
  const inp = newInput();
  let li = 0;
  while (run.phase !== 'done' && run.tick < maxTicks) {
    while (li < inputLog.length && inputLog[li][0] <= run.tick) { unpack(inputLog[li].slice(1), inp); li++; }
    advance(run, inp);
  }
  if (run.phase !== 'done') finish(run, 'timeout');
  run.inputLog = inputLog;
  return run;
}
