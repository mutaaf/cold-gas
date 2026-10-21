// One attempt, start line to settle: steps the vehicle, quantises and records the input (so the
// run can be re-simulated exactly), records replay frames, and measures everything the judges
// score. Pure and deterministic: the Worker runs this same file to verify a submitted run.
import { createVehicle, step, bodyRates, up, forward, worldPoint, newInput, DT, CAR, NOZZLES, HULL, massOf, VALVE_KEYS } from './vehicle.js';
import { COURSES, DEFAULT_COURSE, WALL, LINEUP, SHOW, roofUnder, wallArcLength } from './courses.js';
import { SPEC } from './spec.js';
import { v3 } from './m3.js';
import { createDamage, updateDamage, damageFacts } from './damage.js';
import { datan2, dacos, dhypot } from './dmath.js';

// v14: LAND rolls out at the reveal's pace on no more thrust than the roll needs (the car falls
// nearly free off the lip), then brakes late and hard through the blowdown to a set-down from 2.5 m;
// down-jets 23 kN front / 16 kN rear (pitch-free 76.5 kN, 3.2 G); brakePeakG telemetry.
// v12: the parked row at its researched sizes and curb masses (docs/VEHICLES.md).
// v11: the input log gains `manual` + ten valve channels (Advanced: per-thruster control); LAND rolls
// out decisively from inverted, plans its brake on the end-of-stop pressure, holds the line and
// protects the lift it needs; Pro is rate control; Assist limits the crawl up the curl and the
// airborne carry; TC/ABS in every tier; the tier is telemetry.
// v10: angular momentum integration and rotational air drag (no NaN at Pro spin rates).
// v13: fan suction scheduled from the deck's tilt (and the grip void at a launch or a hard
// stop), 1.5 s spool, held demand: the livestream DOWNFORCE channel; v11: the skill ladder;
// v9: bodywork folds (elastic to a 100 kN yield per hull probe, then plastic crush), no artificial
// spin damping while the hull is in contact, impact events; v8: taller Wall, sourced mass
// distribution; v7: body geometry; v6: The Show is one flight (off the Wall, over the row); parked
// vehicles are bodies with mass, per-surface materials; v5: driver-relative steer/roll/yaw,
// grip-limited steering; v4: sourced specs (docs/REVEAL_RESEARCH.md); v3: dmath; v2: physics v2
export const SIM_VERSION = 14;
export const FRAME_EVERY = 4;           // replay frame every 4 ticks = 60 Hz
export const MAX_TICKS = 240 * 90;      // 90 s hard cap
const G_WIN = 120;                      // 0.5 s of ticks: the braking peak's averaging window

// The input log's channels. v11 appended `manual` and v0..v9 (one per nozzle, NOZZLE_SPEC order).
const LEGACY_KEYS = ['throttle', 'brake', 'steer', 'pitch', 'roll', 'yaw', 'lift', 'thrust', 'retro', 'level', 'fan', 'assist'];
const KEYS = [...LEGACY_KEYS, 'manual', ...VALVE_KEYS];
export const INPUT_KEYS = KEYS;
export const LEGACY_INPUT_KEYS = LEGACY_KEYS;
// A log entry is [tick, ...channels]. Entries from an older client (12 channels) still verify: the
// channels they lack are zero (no manual mode, valves shut), so they replay as they were flown,
// under today's physics (as every log has on every SIM_VERSION bump).
export const isLogEntryLength = (n) => n === KEYS.length + 1 || n === LEGACY_KEYS.length + 1;

// Quantise a raw input to the canonical integers both client and server use.
export function quantise(raw, out) {
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i];
    out[k] = Math.round(Math.max(-1, Math.min(1, raw[k] || 0)) * 100) / 100;
  }
  return out;
}
const pack = (q) => KEYS.map((k) => Math.round(q[k] * 100));
const unpack = (arr, out) => { for (let i = 0; i < KEYS.length; i++) out[KEYS[i]] = (arr[i] || 0) / 100; return out; };

// Everything the judges score.
function newTelemetry(courseId) {
  return {
    course: courseId, crossedRow: false, deckScrape: false,
    launchSpeed: 0, launchTick: -1, airStartTick: -1, touchTick: -1, endTick: -1,
    apex: 0, apexZ: 0, rollAccum: 0, pitchAccum: 0, yawAccum: 0, offAxis: 0,
    minClearance: Infinity, contact: false, contactSpeed: 0, contactTick: -1,
    airAtLaunch: CAR.airMass, airAtTouch: 0, airEnd: 0,
    sink: 0, tiltDeg: 0, headingDeg: 0, lateral: 0, landZ: 0, landSpeed: 0,
    wheelTouch: [-1, -1, -1, -1], wheelSpreadMs: 0, maxCompression: 0, bottomOut: false,
    bodyStrike: false, flipped: false, settledUpright: false, maxSpeed: 0,
    thrustChanges: 0, endReason: '',
    // Flight tier, from the inputs actually flown: any Assist tick makes it an Assist run; an
    // Advanced run is manual on every tick of the flight (from release to touchdown).
    usedAssist: false, usedPro: false, usedManual: false, tier: 'assist',
    zeroToSixty: null,
    // The Wall.
    rampEntrySpeed: 0, rampTick: -1, maxRampHeight: 0, progress: 0, invertedTime: 0, maxG: 0,
    // The braking peak, read like the livestream's G-FORCE channel: the most specific force
    // averaged over 0.5 s, while the down-jets brake a fall with the roof up (not the release kick
    // or a contact spike, which maxG catches), and the height mid-window (m, CoM height over the ground less its height at rest).
    brakePeakG: 0, brakePeakH: 0,
    launchHeight: 0, launchUpY: 1, launchProgress: 0, fellOff: false, landedOnRamp: false,
    // Damage (src/sim/damage.js): filled from the run's damage sensor when the book closes.
    damage: null,
  };
}

export function createRun(courseId = DEFAULT_COURSE) {
  const course = COURSES[courseId] || COURSES[DEFAULT_COURSE];
  const run = {
    course: course.id,
    car: createVehicle(course.id),
    damage: createDamage(),    // the damage sensor: per-zone %, total (src/sim/damage.js)
    phase: 'drive',            // drive → ramp (Wall, Show) → air → landed → done
    tick: 0,
    inputLog: [],              // [tick, ...ints] whenever the quantised input changes
    lastPacked: '',
    flippedTicks: 0, airTicks: 0, offTicks: 0,
    frames: [],                // see recordFrame for the layout
    gWin: new Float64Array(G_WIN), gSum: 0,   // the last 0.5 s of specific force (g), for brakePeakG
    hWin: new Float64Array(G_WIN),            // and the height over it (the peak is placed mid-window)
    t: newTelemetry(course.id),
  };
  run.impacts = run.car.impacts;   // impact events (src/sim/impacts.js): the crash, for the renderer and the replay
  return run;
}

const q = newInput();
const rates = v3(), upv = v3(), fw = v3(), p = v3();

// Replay frame: pos(3) quat(4) wheel compression(4) wheel spin(4) throttles(10) steer fan, then
// each parked vehicle's pose (x, z, yaw), so a shoved car replays where it was shoved.
export const FRAME_SIZE = 7 + 4 + 4 + NOZZLES.length + 2;
export const BODY_FRAME = FRAME_SIZE;
function recordFrame(run) {
  const c = run.car, bodies = c.world.bodies;
  const f = new Float32Array(FRAME_SIZE + 3 * bodies.length);
  for (let i = 0; i < bodies.length; i++) { f[FRAME_SIZE + 3 * i] = bodies[i].cx; f[FRAME_SIZE + 3 * i + 1] = bodies[i].cz; f[FRAME_SIZE + 3 * i + 2] = bodies[i].yaw; }
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
  if (input.assist) t.usedAssist = true;
  else if (input.manual) t.usedManual = true;
  else if (run.phase === 'air' || run.phase === 'ramp') t.usedPro = true;
  // The Wall's rules run the Wall and the Show (which is the Wall with the row under its ledge).
  const show = run.course === 'show';
  const wall = run.course !== 'lineup';
  const course = show ? SHOW : wall ? WALL : LINEUP;
  const prevLift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  const prevVx = c.vel.x, prevVy = c.vel.y, prevVz = c.vel.z;
  step(c, input);
  updateDamage(run.damage, c, HULL);
  run.tick++;
  if (run.tick % FRAME_EVERY === 0) recordFrame(run);

  const speed = dhypot(c.vel.x, c.vel.y, c.vel.z);
  t.maxSpeed = Math.max(t.maxSpeed, speed);
  if (t.zeroToSixty === null && dhypot(c.vel.x, c.vel.z) >= 26.8224) t.zeroToSixty = Math.round(run.tick * DT * 100) / 100;
  const lift = c.throttles[0] + c.throttles[1] + c.throttles[2] + c.throttles[3];
  if (Math.abs(lift - prevLift) > 0.08) t.thrustChanges++;
  // Felt acceleration in g (what the car's occupant would feel), the number the stunt is about.
  const ax = (c.vel.x - prevVx) / DT, ay = (c.vel.y - prevVy) / DT + 9.81, az = (c.vel.z - prevVz) / DT;
  const g = Math.min(25, dhypot(ax, ay, az) / 9.81);
  if (run.tick > 30) t.maxG = Math.max(t.maxG, g);
  const wi = run.tick % G_WIN;
  run.gSum += g - run.gWin[wi]; run.gWin[wi] = g; run.hWin[wi] = Math.max(0, c.pos.y - SPEC.comHeight);
  if (c.obstacleContact && !t.contact) { t.contact = true; t.contactSpeed = c.obstacleSpeed; t.contactTick = run.tick; }
  up(c, upv);
  if (run.phase === 'air' && run.tick >= G_WIN && upv.y > 0.7 && c.vel.y < 0 && lift > 1 && run.gSum / G_WIN > t.brakePeakG) {
    t.brakePeakG = run.gSum / G_WIN; t.brakePeakH = run.hWin[(run.tick + G_WIN / 2) % G_WIN];
  }
  const airborne = c.grounded === 0 && !c.hullContact;
  const lx = c.pos.x, lz = c.pos.z;

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
    const overRow = show ? lz < course.rowNear + 3 && lz > course.rowFar - 3 : !wall && lz > course.lineupZ0 - 3 && lz < course.lineupEnd + 3;
    if (overRow) {
      for (let i = 0; i < HULL.length; i++) {
        worldPoint(c, HULL[i], p);
        const roof = roofUnder(c.world, p.x, p.z);
        if (roof > -Infinity) t.minClearance = Math.min(t.minClearance, p.y - roof);
      }
    }
    if (show && lz < course.rowFar) t.crossedRow = true;
    const minAir = wall ? 48 : 36;
    // On the Wall, touching the deck while still up high is a scrape off the lip, not a landing.
    const deckScrape = wall && (c.grounded > 0 || c.hullGround) && c.pos.y > 3 && wallArcLength(c.pos.z, c.pos.y) > 1;
    if (deckScrape) t.deckScrape = true;
    if ((c.grounded > 0 || c.hullGround) && !deckScrape && run.tick - t.airStartTick > minAir) {
      run.phase = 'landed';
      t.touchTick = run.tick;
      t.sink = Math.max(0, -c.vel.y);
      forward(c, fw);
      t.tiltDeg = dacos(Math.max(-1, Math.min(1, upv.y))) * 180 / Math.PI;
      // Heading error against the run direction (the Wall sends you back the way you came).
      t.headingDeg = datan2(wall ? -fw.x : fw.x, wall ? -fw.z : fw.z) * 180 / Math.PI;
      t.lateral = lx - course.pad.x;
      t.landZ = lz;
      t.landSpeed = dhypot(c.vel.x, c.vel.z);
      t.airAtTouch = c.air;
      if (wall && c.pos.y > 1.2 && wallArcLength(c.pos.z, c.pos.y) > 1) t.landedOnRamp = true;
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
  // A non-finite state would poison the replay, the scorecard and the HUD. The integrator is built
  // never to produce one; if it ever does, end the run cleanly instead of drawing NaN.
  if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.quat.w + c.angVel.x + c.angVel.y + c.angVel.z + c.vel.x + c.vel.y + c.vel.z)) { finish(run, 'sim-fault'); return run; }
  if (t.flipped) end = 'flipped';
  else if (t.contact && run.tick - t.contactTick > 480) end = 'contact';
  else if (run.phase === 'landed' && (speed < 1.2 || run.tick - t.touchTick > 240 * 5)) end = 'settled';
  else if (c.pos.z > COURSES[run.course].runout.zMax || c.pos.z < COURSES[run.course].runout.zMin) end = 'runout';
  else if (run.offTicks > 240 * 6) end = 'stalled';
  else if (run.tick >= MAX_TICKS) end = 'timeout';
  else if (!wall && run.phase === 'drive' && lz > course.lineupEnd + 4 && c.grounded > 0) end = 'no-jump';
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
  t.tier = t.usedAssist ? 'assist' : t.usedManual && !t.usedPro ? 'advanced' : 'pro';
  t.airEnd = c.air;
  up(c, upv);
  t.settledUpright = upv.y > 0.8 && !t.flipped;
  if (t.wheelTouch.every((x) => x >= 0)) t.wheelSpreadMs = (Math.max(...t.wheelTouch) - Math.min(...t.wheelTouch)) * DT * 1000;
  else t.wheelSpreadMs = 1000;
  t.bottomOut = t.maxCompression > CAR.restLen - CAR.mountToCentre + CAR.maxTravel + 0.02;
  t.mass = massOf(c);
  t.damage = damageFacts(run.damage);
}

// Re-simulate a run from its input log alone (replay, server verification). `onTick(run, input)`
// (optional) sees every tick: the coach (src/sim/coach.js) reads the flight through it.
export function simulate(inputLog, courseId = DEFAULT_COURSE, maxTicks = MAX_TICKS, onTick = null) {
  const run = createRun(courseId);
  const inp = newInput();
  let li = 0;
  while (run.phase !== 'done' && run.tick < maxTicks) {
    while (li < inputLog.length && inputLog[li][0] <= run.tick) { unpack(inputLog[li].slice(1), inp); li++; }
    advance(run, inp);
    if (onTick) onTick(run, inp);
  }
  if (run.phase !== 'done') finish(run, 'timeout');
  run.inputLog = inputLog;
  return run;
}
