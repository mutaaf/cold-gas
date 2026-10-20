// One attempt, start line to settle: steps the vehicle, quantises and records the input (so the
// run can be re-simulated exactly), records replay frames, and measures everything the judges
// score. Pure and deterministic: the Worker runs this same file to verify a submitted run.
import { createVehicle, step, bodyRates, up, forward, worldPoint, newInput, DT, CAR, NOZZLES, HULL, massOf } from './vehicle.js';
import { RAMP, LINEUP, LINEUP_Z0, LINEUP_END, roofUnder, PAD, RUNOUT_Z } from './course.js';
import { v3 } from './m3.js';

export const SIM_VERSION = 1;
export const FRAME_EVERY = 4;           // replay frame every 4 ticks = 60 Hz
export const MAX_TICKS = 240 * 45;      // 45 s hard cap

const KEYS = ['throttle', 'brake', 'steer', 'pitch', 'roll', 'yaw', 'lift', 'thrust', 'retro', 'level', 'assist'];
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

export function createRun() {
  return {
    car: createVehicle(),
    phase: 'drive',            // drive → air → landed → done
    tick: 0,
    inputLog: [],              // [tick, ...ints] whenever the quantised input changes
    lastPacked: '',
    flippedTicks: 0,
    frames: [],                // Float32Array(14) per frame: pos(3) quat(4) wheel comp(4)… see recordFrame
    t: {
      launchSpeed: 0, launchTick: -1, airStartTick: -1, touchTick: -1, endTick: -1,
      apex: 0, apexZ: 0, rollAccum: 0, pitchAccum: 0, yawAccum: 0, offAxis: 0,
      minClearance: Infinity, contact: false, contactSpeed: 0, contactTick: -1,
      airAtLaunch: CAR.airMass, airAtTouch: 0, airEnd: 0,
      sink: 0, tiltDeg: 0, headingDeg: 0, lateral: 0, landZ: 0, landSpeed: 0,
      wheelTouch: [-1, -1, -1, -1], wheelSpreadMs: 0, maxCompression: 0, bottomOut: false,
      bodyStrike: false, flipped: false, settledUpright: false, maxSpeed: 0,
      thrustChanges: 0, endReason: '',
    },
  };
}

const q = newInput();
const rates = v3(), upv = v3(), fw = v3(), p = v3();

function recordFrame(run) {
  const c = run.car;
  const f = new Float32Array(7 + 4 + 4 + NOZZLES.length);
  f[0] = c.pos.x; f[1] = c.pos.y; f[2] = c.pos.z;
  f[3] = c.quat.x; f[4] = c.quat.y; f[5] = c.quat.z; f[6] = c.quat.w;
  for (let i = 0; i < 4; i++) { f[7 + i] = c.wheels[i].compression; f[11 + i] = c.wheels[i].spin; }
  for (let i = 0; i < NOZZLES.length; i++) f[15 + i] = c.throttles[i];
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

function advance(run, input) {
  const c = run.car, t = run.t;
  const prevZ = c.pos.z;
  const prevLift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  step(c, input);
  run.tick++;
  if (run.tick % FRAME_EVERY === 0) recordFrame(run);

  const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  t.maxSpeed = Math.max(t.maxSpeed, speed);
  const lift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  if (Math.abs(lift - prevLift) > 0.08) t.thrustChanges++;

  if (prevZ < RAMP.z1 && c.pos.z >= RAMP.z1 && t.launchTick < 0) {
    t.launchTick = run.tick; t.launchSpeed = speed; t.airAtLaunch = c.air;
  }

  if (c.obstacleContact && !t.contact) { t.contact = true; t.contactSpeed = c.obstacleSpeed; t.contactTick = run.tick; }

  if (run.phase === 'drive') {
    if (c.grounded === 0 && c.pos.z > RAMP.z0) { run.phase = 'air'; t.airStartTick = run.tick; }
  } else if (run.phase === 'air') {
    bodyRates(c, rates);
    t.rollAccum += rates.z * DT;
    t.pitchAccum += rates.x * DT;
    t.yawAccum += rates.y * DT;
    t.offAxis += (Math.abs(rates.x) + Math.abs(rates.y)) * DT;
    if (c.pos.y > t.apex) { t.apex = c.pos.y; t.apexZ = c.pos.z; }
    // Clearance: lowest hull point over any roof.
    if (c.pos.z > LINEUP_Z0 - 3 && c.pos.z < LINEUP_END + 3) {
      for (let i = 0; i < HULL.length; i++) {
        worldPoint(c, HULL[i], p);
        const roof = roofUnder(p.x, p.z);
        if (roof > -Infinity) t.minClearance = Math.min(t.minClearance, p.y - roof);
      }
    }
    if ((c.grounded > 0 || c.hullGround) && run.tick - t.airStartTick > 36) {
      run.phase = 'landed';
      t.touchTick = run.tick;
      t.sink = Math.max(0, -c.vel.y);
      up(c, upv); forward(c, fw);
      t.tiltDeg = Math.acos(Math.max(-1, Math.min(1, upv.y))) * 180 / Math.PI;
      t.headingDeg = Math.atan2(fw.x, fw.z) * 180 / Math.PI;
      t.lateral = c.pos.x - PAD.x;
      t.landZ = c.pos.z;
      t.landSpeed = Math.hypot(c.vel.x, c.vel.z);
      t.airAtTouch = c.air;
    } else if (c.grounded > 0 && run.tick - t.airStartTick <= 36) {
      // A hop, not a jump (e.g. bounced on the ramp): back to driving.
      run.phase = 'drive';
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

  // Flip detection: upside down while touching anything.
  up(c, upv);
  if (upv.y < 0.25 && (c.grounded > 0 || c.hullContact) && run.phase !== 'air') run.flippedTicks++;
  else run.flippedTicks = 0;
  if (run.flippedTicks > 120) t.flipped = true;

  // End conditions.
  let end = '';
  if (t.flipped) end = 'flipped';
  else if (t.contact && run.tick - t.contactTick > 480) end = 'contact';
  else if (run.phase === 'landed' && (speed < 1.2 || run.tick - t.touchTick > 240 * 5)) end = 'settled';
  else if (c.pos.z > RUNOUT_Z) end = 'runout';
  else if (run.tick >= MAX_TICKS) end = 'timeout';
  else if (run.phase === 'drive' && c.pos.z > LINEUP_END + 4 && c.grounded > 0) end = 'no-jump';
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
  t.bottomOut = t.maxCompression > CAR.maxTravel + 0.02;
  t.mass = massOf(c);
}

// Re-simulate a run from its input log alone (replay, server verification).
export function simulate(inputLog, maxTicks = MAX_TICKS) {
  const run = createRun();
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
