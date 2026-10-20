// One attempt, start line to settle: steps the vehicle, quantises and records the input (so the
// run can be re-simulated exactly), records replay frames, and measures everything the judges
// score. Pure and deterministic: the Worker runs this same file to verify a submitted run.
import { createVehicle, step, bodyRates, up, forward, worldPoint, newInput, DT, CAR, NOZZLES, HULL, massOf } from './vehicle.js';
import { COURSES, DEFAULT_COURSE, WALL, roofUnder, wallArcLength } from './courses.js';
import { SPEC } from './spec.js';
import { v3 } from './m3.js';
import { datan2, dacos, dhypot } from './dmath.js';

export const SIM_VERSION = 4;           // v4: sourced specs (docs/REVEAL_RESEARCH.md); v3: dmath; v2: physics v2
export const FRAME_EVERY = 4;           // replay frame every 4 ticks = 60 Hz
export const MAX_TICKS = 240 * 60;      // 60 s hard cap

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

export function createRun(courseId = DEFAULT_COURSE) {
  const course = COURSES[courseId] || COURSES[DEFAULT_COURSE];
  return {
    course: course.id,
    car: createVehicle(course.id),
    phase: 'drive',            // drive → ramp (wall only) → air → landed → done
    tick: 0,
    inputLog: [],              // [tick, ...ints] whenever the quantised input changes
    lastPacked: '',
    flippedTicks: 0, airTicks: 0, offTicks: 0,
    frames: [],                // see recordFrame for the layout
    t: {
      course: course.id,
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
    },
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
  const wall = run.course === 'wall';
  const course = COURSES[run.course];
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

  if (run.phase === 'drive') {
    if (wall) {
      if (c.onWall || (c.pos.z > 0.5 && c.pos.y > 1.2)) {
        run.phase = 'ramp'; t.rampTick = run.tick; t.rampEntrySpeed = speed;
      }
    } else {
      // The Lineup has no ramp: the car lifts off flat ground on thrust alone.
      run.airTicks = c.grounded === 0 ? run.airTicks + 1 : 0;
      if (run.airTicks > 12) {
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
    if (!wall && c.pos.z > course.lineupZ0 - 3 && c.pos.z < course.lineupEnd + 3) {
      for (let i = 0; i < HULL.length; i++) {
        worldPoint(c, HULL[i], p);
        const roof = roofUnder(p.x, p.z);
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
      // Heading error against the run direction (the Wall sends you back the way you came).
      const hz = wall ? -fw.z : fw.z;
      t.headingDeg = datan2(wall ? -fw.x : fw.x, hz) * 180 / Math.PI;
      t.lateral = c.pos.x - course.pad.x;
      t.landZ = c.pos.z;
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

  let end = '';
  if (t.flipped) end = 'flipped';
  else if (t.contact && run.tick - t.contactTick > 480) end = 'contact';
  else if (run.phase === 'landed' && (speed < 1.2 || run.tick - t.touchTick > 240 * 5)) end = 'settled';
  else if (c.pos.z > course.runout.zMax || c.pos.z < course.runout.zMin) end = 'runout';
  else if (run.offTicks > 240 * 6) end = 'stalled';
  else if (run.tick >= MAX_TICKS) end = 'timeout';
  else if (!wall && run.phase === 'drive' && c.pos.z > course.lineupEnd + 4 && c.grounded > 0) end = 'no-jump';
  else if (!wall && run.phase === 'drive' && c.obstacleContact) end = 'no-jump';
  if (end) finish(run, end);
  return run;
}

function finish(run, reason) {
  const c = run.car, t = run.t;
  run.phase = 'done';
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
