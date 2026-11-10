// The sim's golden traces for the native port (docs/NATIVE.md §3, ticket 0146). The Swift core
// (ios/Packages/ColdGasCore) replays every file this writes and must match it bit for bit:
// numbers are stored as their IEEE 754 bit patterns (16 hex digits, big-endian), never as decimals.
// Pure and deterministic: same bytes on every machine and every run (no Math.random, no clock).
// scripts/vectors.mjs writes or checks the files; tests/unit/vectors.test.js checks a sample.
import { createRun, stepRun, simulate, wallProgress, armAftermath, aftermathStep, SIM_VERSION } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { newInput, CAR } from '../src/sim/vehicle.js';
const AIR_MASS = CAR.airMass;
import { scoreRun } from '../src/sim/judge.js';
import { dsin, dcos, datan, datan2, dacos, dhypot, dexp, dlog } from '../src/sim/dmath.js';
import { RAPIER } from '../src/sim/engine.js';
import { engineSpike } from './engine-spike.js';
import { SPEC } from '../src/sim/spec.js';
import { predict, newPrediction } from '../src/sim/predict.js';
import { markOffset } from '../src/onethumb.js';
import { input as IN, touchSettings, dom, STICK } from './vectors-dom.mjs';
import { packBytes, unpackBytes, toB64url, fromB64url, vsFromHash, challengeUrl, compare, coarsen, COARSE_STEPS, CHANNELS, VS_MAX_CHARS } from '../src/challenge.js';
import { localWords, boardRow, postMessage, rankLabel, LOCAL_WHY } from '../src/panel.js';
import { OBJECTIVES, EPOCH, objectiveIndex, dayKey, dayNumber, evaluate, missLine, titleHint, readStreak, streakNow, complete } from '../src/daily.js';
import { one, both, setUnits, getUnits, localize, toUS, fmtRoad, fmtSmall } from '../src/units.js';
import { EDGE_DEFAULT } from '../src/ai/config.js';
import { coach, readFlight, markMiss, markCost, sinkCost, namesMark, namesBraking, KEY_WORDS } from '../src/sim/coach.js';
import { coachWords } from '../src/pointer.js';
import { DRILLS, drillById, buildDrill, drillResult, drillCoach } from '../src/practice.js';

export const VECTOR_FORMAT = 1;
export const VECTOR_DIR = 'ios/Packages/ColdGasCore/Tests/Vectors';
export const CHECK_EVERY = 24;     // a cumulative state hash every 24 ticks (0.1 s)
export const FULL_EVERY = 240;     // the full state every 240 ticks (1 s), to name the field that differs

// --- bits ------------------------------------------------------------------------------------
const dv = new DataView(new ArrayBuffer(8));
// A NaN is written canonically: x86 computes a negative "default NaN" (fff8…) where ARM computes a positive one
// (7ff8…), and DataView writes whichever the hardware made (dsin(±∞) differed between CI and a Mac). A NaN's
// sign and payload aren't part of JS's semantics, and the Swift side treats any NaN as equal to any NaN.
const NAN_HEX = '7ff8000000000000';
export function hex(x) {
  if (x !== x) return NAN_HEX;
  dv.setFloat64(0, x);
  return dv.getUint32(0).toString(16).padStart(8, '0') + dv.getUint32(4).toString(16).padStart(8, '0');
}
export function unhex(h) {
  dv.setUint32(0, parseInt(h.slice(0, 8), 16)); dv.setUint32(4, parseInt(h.slice(8), 16));
  return dv.getFloat64(0);
}

// A seeded 32-bit xorshift (integer only, portable to Swift as UInt32 arithmetic).
export function xorshift(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const U32 = 4294967296;

// --- dmath -----------------------------------------------------------------------------------
export const DMATH_N = 5000;
const SPECIAL = [0, -0, 1, -1, 0.5, -0.5, Math.PI / 4, -Math.PI / 4, 0.7853981633974483, -0.7853981633974483,
  0.7853981633974482, Math.PI / 2, Math.PI, -Math.PI, 2 * Math.PI, 1e5, -1e5, 0.4375, 0.6875, 1.1875, 2.4375, 4.4e15,
  1e-300, 5e-324, -5e-324, 2.2250738585072014e-308, 709.782712893384, -745.1332191019411, 3.725290298461914e-9,
  1e308, Infinity, -Infinity, NaN];
// Inputs per function: the specials, then a seeded walk over the range a stunt uses and well past it.
function inputs(seed, lo, hi, n = DMATH_N) {
  const r = xorshift(seed), out = SPECIAL.slice();
  while (out.length < n) {
    const u = r() / U32, k = r() & 3;
    // Uniform over [lo, hi], and three log-spread bands near zero (where a kernel's polynomial is tested).
    out.push(k === 0 ? lo + (hi - lo) * u : (r() & 1 ? 1 : -1) * u * (k === 1 ? 1 : k === 2 ? 1e-3 : 1e-8));
  }
  return out;
}
function pairs(seed, lo, hi) {
  const a = inputs(seed, lo, hi), b = inputs(seed ^ 0x9e3779b9, lo, hi);
  return a.map((x, i) => [x, b[(i * 7 + 3) % b.length]]);
}
export function dmathVectors() {
  const one = (name, f, xs) => ({ name, args: 1, cases: xs.map((x) => [hex(x), hex(f(x))]) });
  const two = (name, f, xys) => ({ name, args: 2, cases: xys.map(([x, y]) => [hex(x), hex(y), hex(f(x, y))]) });
  const three = (name, f, seed) => {
    const a = inputs(seed, -500, 500), b = inputs(seed + 1, -500, 500), c = inputs(seed + 2, -500, 500);
    return { name, args: 3, cases: a.map((x, i) => [hex(x), hex(b[(i * 5 + 1) % b.length]), hex(c[(i * 11 + 2) % c.length]),
      hex(dhypot(x, b[(i * 5 + 1) % b.length], c[(i * 11 + 2) % c.length]))]) };
  };
  return {
    format: VECTOR_FORMAT, simVersion: SIM_VERSION,
    functions: [
      one('dsin', dsin, inputs(11, -4 * Math.PI, 4 * Math.PI)),
      one('dcos', dcos, inputs(12, -4 * Math.PI, 4 * Math.PI)),
      one('dsin_wide', dsin, inputs(13, -1e5, 1e5)),
      one('dcos_wide', dcos, inputs(14, -1e5, 1e5)),
      one('datan', datan, inputs(15, -1e6, 1e6)),
      two('datan2', datan2, pairs(16, -1000, 1000)),
      one('dacos', dacos, inputs(17, -1, 1)),
      two('dhypot2', (a, b) => dhypot(a, b), pairs(18, -1e4, 1e4)),
      three('dhypot3', dhypot, 19),
      one('dexp', dexp, inputs(20, -60, 60)),
      one('dlog', dlog, inputs(21, 0, 1e6).map(Math.abs)),
    ],
  };
}

// --- runs ------------------------------------------------------------------------------------
const PHASES = ['drive', 'ramp', 'air', 'landed', 'done'];
// The state a tick is judged by: the car's pose and motion, the nitrogen, the phase, each wheel's contact.
function stateOf(run) {
  const c = run.car, w = c.wheels;
  return [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.vel.x, c.vel.y, c.vel.z,
    c.angVel.x, c.angVel.y, c.angVel.z, c.angMom.x, c.angMom.y, c.angMom.z, c.air,
    PHASES.indexOf(run.phase), w[0].contact ? 1 : 0, w[1].contact ? 1 : 0, w[2].contact ? 1 : 0, w[3].contact ? 1 : 0];
}
export const STATE_FIELDS = ['pos.x', 'pos.y', 'pos.z', 'quat.x', 'quat.y', 'quat.z', 'quat.w', 'vel.x', 'vel.y', 'vel.z',
  'angVel.x', 'angVel.y', 'angVel.z', 'angMom.x', 'angMom.y', 'angMom.z', 'air', 'phase', 'wheel0', 'wheel1', 'wheel2', 'wheel3'];

// Two 32-bit lanes over each double's two words (FNV-1a and a murmur-style mix), chained across ticks.
// Integer only: Swift reproduces it with UInt32 &* and ^.
export function mixState(h, vals) {
  let a = h[0], b = h[1];
  for (const v of vals) {
    dv.setFloat64(0, v !== v ? NaN : v);
    if (v !== v) { dv.setUint32(0, 0x7ff80000); dv.setUint32(4, 0); }   // canonical NaN (see hex)
    for (const w of [dv.getUint32(0), dv.getUint32(4)]) {
      a = Math.imul(a ^ w, 16777619) >>> 0;
      b = Math.imul(b ^ w, 0x5bd1e995) >>> 0; b = (b ^ (b >>> 15)) >>> 0;
    }
  }
  h[0] = a; h[1] = b;
}
const hashHex = (h) => h[0].toString(16).padStart(8, '0') + h[1].toString(16).padStart(8, '0');

// Every number in a value as [path, 'n', bits]; booleans, strings and nulls as themselves.
export function flat(v, path = '', out = []) {
  if (typeof v === 'number') out.push([path, 'n', hex(v)]);
  else if (typeof v === 'boolean') out.push([path, 'b', v]);
  else if (typeof v === 'string') out.push([path, 's', v]);
  else if (v === null || v === undefined) out.push([path, 'z', null]);
  else if (ArrayBuffer.isView(v) || Array.isArray(v)) Array.from(v).forEach((x, i) => flat(x, `${path}[${i}]`, out));
  else for (const k of Object.keys(v).sort()) flat(v[k], path ? `${path}.${k}` : k, out);
  return out;
}

// Replay a log the way the server and a challenge do (simulate), recording the trace.
export function runVector(name, course, log, keep = null) {
  const h = [0x811c9dc5, 0x9747b28c], checks = [], full = [];
  const run = simulate(log, course, undefined, (r) => {
    const s = stateOf(r);
    mixState(h, s);
    if (r.tick % CHECK_EVERY === 0) checks.push([r.tick, hashHex(h)]);
    if (r.tick % FULL_EVERY === 0) full.push([r.tick, s.map(hex)]);
  });
  if (keep) keep.t = run.t;
  return {
    format: VECTOR_FORMAT, simVersion: SIM_VERSION, name, course, ticks: run.tick,
    log, checkEvery: CHECK_EVERY, fullEvery: FULL_EVERY, fields: STATE_FIELDS,
    final: hashHex(h), checks, full,
    telemetry: flat(run.t), card: flat(scoreRun(run.t)),
  };
}

// The logs: flown live (stepRun) by the reference pilots, the naive players, crash recipes and a
// seeded Pro fuzz. Each returns its input log; runVector replays it.
const fly = (course, controller) => {
  const run = createRun(course);
  while (run.phase !== 'done') stepRun(run, controller(run));
  return run.inputLog;
};
const auto = (course, opts) => () => fly(course, createAutopilot(course, opts));
function naiveWall({ approach, climbThrottle, releaseAt }) {
  let released = false;
  return fly('wall', (run) => {
    const c = run.car, inp = newInput(); inp.assist = 1;
    const v = dhypot(c.vel.x, c.vel.y, c.vel.z);
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (run.phase === 'drive') { inp.throttle = approach === 'floored' || v < approach ? 1 : 0; inp.fan = c.pos.z > -16 ? 1 : 0; }
    else if (run.phase === 'ramp' && !released) {
      inp.throttle = climbThrottle; inp.fan = 1;
      if (wallProgress(c.pos) >= releaseAt) released = true;
      if (released) inp.lift = 1;
    } else if (run.phase === 'ramp' || run.phase === 'air') inp.level = 1;
    else inp.brake = 1;
    return inp;
  });
}
function naiveShow({ climb, releaseAt, boost }) {
  let released = false, boostT = 0;
  return fly('show', (run) => {
    const c = run.car, inp = newInput(); inp.assist = 1;
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));
    if (run.phase === 'drive') { inp.throttle = dhypot(c.vel.x, c.vel.z) < 6 ? 1 : 0; inp.fan = 1; }
    else if (run.phase === 'ramp' && !released) {
      const v = dhypot(c.vel.x, c.vel.y, c.vel.z);
      inp.throttle = v < climb ? 0.8 : 0; inp.brake = v > climb + 1.5 ? 0.3 : 0; inp.fan = 1;
      if (wallProgress(c.pos) >= releaseAt) released = true;
      if (released) inp.lift = 1;
    } else if (run.phase === 'ramp' || run.phase === 'air') {
      if (boostT < boost) { inp.thrust = 1; boostT += 1 / 240; } else inp.level = 1;
    } else inp.brake = 1;
    return inp;
  });
}
function proFuzz(trial) {
  const r = xorshift(0xc01d6a5 + trial * 7919), u = () => r() / U32;
  const course = ['lineup', 'show', 'wall'][trial % 3];
  const p = { at: 60 + ((r() % 600) | 0), dur: 100 + ((r() % 500) | 0), roll: u() * 2 - 1, pitch: u() * 2 - 1, yaw: u() * 2 - 1, thr: u() };
  return { course, log: () => fly(course, (run) => {
    const i = newInput(); i.assist = 0; i.fan = course === 'lineup' ? 0 : 1;
    if (run.phase === 'drive') i.throttle = p.thr;
    if (run.tick > p.at && run.tick < p.at + p.dur) i.lift = 1;
    if (run.phase === 'air') { i.roll = p.roll; i.pitch = p.pitch; i.yaw = p.yaw; }
    if (run.tick >= 240 * 25) i.brake = 1;
    return i;
  }) };
}

export function runList() {
  const list = [
    { name: 'ref-show', course: 'show', log: auto('show') },
    { name: 'ref-wall', course: 'wall', log: auto('wall') },
    { name: 'ref-lineup', course: 'lineup', log: auto('lineup') },
    { name: 'ref-show-advanced', course: 'show', log: auto('show', { advanced: true }) },
    { name: 'ref-wall-advanced', course: 'wall', log: auto('wall', { advanced: true }) },
    { name: 'crash-show-carry5', course: 'show', log: auto('show', { carry: 5 }) },
    { name: 'crash-wall-early', course: 'wall', log: auto('wall', { releaseAt: 0.6 }) },
    { name: 'crash-lineup-rolls2', course: 'lineup', log: auto('lineup', { speed: 9, apex: 2.8, rolls: 2 }) },
  ];
  // The 32 naive Wall players (scripts/naive-players.mjs's grid).
  for (const approach of [4, 8, 12, 'floored']) for (const climbThrottle of [0.5, 1]) for (const releaseAt of [0.6, 0.85, 0.97, 1.01]) {
    const st = { approach, climbThrottle, releaseAt };
    list.push({ name: `naive-wall-${approach}-${climbThrottle}-${releaseAt}`, course: 'wall', log: () => naiveWall(st) });
  }
  // Six of the Show's naive players (scripts/naive-show.mjs), the corners of its grid.
  for (const [climb, releaseAt, boost] of [[4, 0.85, 0], [4, 1.01, 0.8], [6, 0.97, 0.25], [6, 0.97, 0.5], [9, 0.85, 0.35], [9, 1.01, 0.15]]) {
    list.push({ name: `naive-show-${climb}-${releaseAt}-${boost}`, course: 'show', log: () => naiveShow({ climb, releaseAt, boost }) });
  }
  // Pro with no rate limit (LESSONS: integrate angular momentum): six seeded tricks.
  for (let trial = 0; trial < 6; trial++) { const f = proFuzz(trial); list.push({ name: `pro-fuzz-${trial}`, course: f.course, log: f.log }); }
  return list;
}

// What the hand should feel, per tick (0149, docs/NATIVE.md §6): the inputs HapticScore reads, from the JS sim,
// until the Swift sim feeds the same struct. Not bit-exact data (haptics are felt, not scored): 4 decimals.
//   [phase, speed m/s, vy m/s, onWall 0|1, wheel contact bits, load ratio, valve flow (Σ throttles), gas 0–1, lift 0|1,
//    impacts this tick as [kind, speed]…]
export const HAPTIC_RUNS = ['ref-show', 'ref-wall', 'ref-lineup', 'crash-show-carry5', 'crash-lineup-rolls2'];
export function hapticFeed(name, course, log) {
  const r4 = (x) => Math.round(x * 1e4) / 1e4, rows = [];
  let seen = 0;
  simulate(log, course, undefined, (run, inp) => {
    const c = run.car, w = c.wheels, im = run.impacts;
    let flow = 0;
    for (let i = 0; i < c.throttles.length; i++) flow += c.throttles[i];
    let contacts = 0, load = 0;
    for (let i = 0; i < 4; i++) { if (w[i].contact) contacts |= 1 << i; load += w[i].load; }
    const hits = [];
    while (seen < im.count) { if (im.tick[seen] <= run.tick) { hits.push([im.kind[seen], r4(im.speed[seen])]); seen++; } else break; }
    rows.push([PHASES.indexOf(run.phase), r4(dhypot(c.vel.x, c.vel.y, c.vel.z)), r4(c.vel.y), c.onWall ? 1 : 0, contacts,
      r4(load / (4 * w[0].load || 1) || 0), r4(flow), r4(Math.max(0, c.air) / AIR_MASS), inp.lift > 0 ? 1 : 0, ...hits]);
  });
  return { format: VECTOR_FORMAT, simVersion: SIM_VERSION, name, course, hz: 240,
    fields: ['phase', 'speed', 'vy', 'onWall', 'contacts', 'load', 'flow', 'gas', 'lift', '...impacts[kind,speed]'], ticks: rows };
}

// --- live play: the input layer (0154) -------------------------------------------------------
// A live run as the page flies it (src/main.js liveStep): each 240 Hz tick the controls are sampled (one-thumb:
// src/input.js sampleThumb → src/onethumb.js; classic touch: src/input.js sample → src/driving.js, src/hands.js),
// main.js wallAssist adds the fan and notes the release, and stepRun quantises and logs it. The run is armed for its
// aftermath (as main.js does), which then steps the crashed or stopped car to rest. A scripted finger presses the
// page's own controls (scripts/vectors-dom.mjs); what it did is recorded per tick as events, so the Swift port
// replays the same touches and must log the same input bit for bit (the Worker re-simulates that log).
//   events  [tick, 'down'|'up'] (the one-thumb pad), [tick, 'move', dx, dy] (its slide, px, +y up the glass),
//           [tick, 'stick', x, y, dx, dy] (the stick, −1…1 as input.js read it, from the finger's px off its centre),
//           [tick, 'stickUp'], [tick, 'press', 'go'|'brk'|'lift'|'land', amount, fy] (amount: an Advanced pedal's, from
//           where on the pad the finger is), [tick, 'release', name], [tick, 'valves', ...10] (the nozzle pad's, after a
//           finger on it), [tick, 'tilt', steer, gamma] (touch-settings.js tiltSteer() after the reading, zeroed at 0°).
//           Numbers as bits.
//   sights  [tick, land, ...PRED_FIELDS bits, status, mark x, y, m]: predict() and markOffset() (the pad's sight),
//           read before that tick's events are applied, as human-phone.mjs's careful thumb reads them.
export const PRED_FIELDS = ['h', 'sink', 'upY', 'aNow', 'aEnd', 'aMax', 'aPlan', 'stopDist', 'brakeBy', 'margin', 'marginAhead',
  'profileSink', 'tGround', 'tLand', 'landX', 'landZ', 'gas', 'gasNeed', 'rollOut', 'pitchOut', 'touchSink', 'brakeSink'];
// src/main.js wallAssist and noteRelease (the page's, with S's two fields passed in: main.js can't load in Node).
function noteRelease(run, S, input) {
  if (S.released || run.course === 'lineup' || !((run.phase === 'ramp' && input.lift > 0) || run.phase === 'air')) return false;
  S.released = true; S.releaseTick = run.tick;
  return true;
}
function wallAssist(run, S, input) {
  if (run.course === 'lineup') { input.fan = 0; return input; }
  const c = run.car;
  noteRelease(run, S, input);
  input.fan = !S.released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
  return input;
}
const liveInput = newInput();
export function inputVector({ name, course, scheme, tier, level, script, drill = null }) {
  dom.fresh();
  IN.setDriving({ level });
  // `drill`: flown from the drill's hand-over, as main.js startDrillNow and newFlight start one (0160).
  const built = drill ? buildDrill(drillById(drill), course) : null;
  const run = armAftermath(built ? built.run : createRun(course));
  const S = { released: !!built?.released, releaseTick: built?.released ? run.tick - 240 : -1 };
  const events = [], sights = [], pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
  const at = (...e) => events.push([run.tick, ...e]);
  const ctl = {
    down() { IN.thumb.down(); at('down'); },
    up() { IN.thumb.up(); at('up'); },
    move(dx, dy) { IN.thumb.move(dx, dy); at('move', hex(dx), hex(dy)); },
    stick(dx, dy) { dom.stick(dx, dy); const h = IN.heldState(); at('stick', hex(h.x), hex(h.y), hex(STICK.cx + dx - STICK.cx), hex(STICK.cy + dy - STICK.cy)); },
    stickUp() { dom.stickUp(); at('stickUp'); },
    press(b, fy = 0.5) { dom.press(b, fy); at('press', b, hex(b === 'go' || b === 'brk' ? IN.pedalAmount(fy) : 1), hex(fy)); },
    release(b) { dom.release(b); at('release', b); },
    tilt(gamma) { dom.tilt(gamma); at('tilt', hex(touchSettings.tiltSteer()), hex(gamma)); },
    nozzle(finger, pad) { dom.nozzle(finger, pad); at('valves', ...Array.from(IN.getNozzlePad().valves, hex)); },
    // The sight as the pad draws it (src/thumb-aim.js): the touchdown predicted, then the mark from it, px.
    sight(land = false) {
      const c = run.car, h = Math.max(0, c.pos.y - SPEC.comHeight);
      predict(c, h, pr, land);
      markOffset(c, pr, course, off, IN.thumb.ref, IN.thumb.refA, scheme === 'thumb' ? IN.thumb.canA : true);   // 0165: the one-thumb pad's sight
      sights.push([run.tick, land ? 1 : 0, ...PRED_FIELDS.map((k) => hex(pr[k])), pr.status, hex(off.x), hex(off.y), hex(off.m)]);
      return off;
    },
  };
  ctl.tilt(0);   // every run starts level (the first reading is straight ahead)
  const h = [0x811c9dc5, 0x9747b28c], checks = [], st = {};
  while (run.phase !== 'done') {
    script(run, S, ctl, st);
    const inp = wallAssist(run, S, scheme === 'thumb' ? IN.sampleThumb(run, S.released, liveInput) : IN.sample(run.phase, tier, liveInput, S.released, run.car));
    stepRun(run, inp);
    mixState(h, stateOf(run));
    if (run.tick % CHECK_EVERY === 0) checks.push([run.tick, hashHex(h)]);
  }
  const ticks = run.tick, final = hashHex(h), telemetry = flat(run.t), card = flat(scoreRun(run.t));
  // The aftermath, as main.js steps it once the run is over: unscored, unlogged, to rest or the cap.
  const ah = [0x811c9dc5, 0x9747b28c];
  for (let done = false; !done;) {
    const t0 = run.tick;
    done = aftermathStep(run);
    if (run.tick !== t0) mixState(ah, stateOf(run));
  }
  const a = run.after;
  return {
    format: VECTOR_FORMAT, simVersion: SIM_VERSION, name, course, scheme, tier, level, ...(built ? { drill, drillStartTick: built.run.drillStartTick } : {}), ticks, releaseTick: S.releaseTick, endReason: run.t.endReason, final,
    after: { startTick: a.startTick, ticks: a.ticks, still: a.still, endTick: run.tick, final: hashHex(ah), state: stateOf(run).map(hex) },
    events, sights, log: run.inputLog, checks, telemetry, card,
  };
}

// The scripted fingers. Each reacts to the run as a player would (the ledge reached, the fall begun), so the
// timeline is a real flight's; what it pressed, and when, is what the vector stores.
const speed = (c) => dhypot(c.vel.x, c.vel.y, c.vel.z);
const onLedge = (run) => run.phase === 'ramp' && run.t.progress >= 0.92 && speed(run.car) < 0.3;
// One-thumb: hold to climb, lift on the ledge, press again after `wait` and hold to land (`landAt: 'again'`: a tap,
// then pressed again `relandAfter` ticks later). `flinch`: the thumb lifted that many ticks in the fall (0140: LAND
// stays on). `aim`: slide onto the sight every `aim` ticks, a reaction (48 ticks) late. `lapse`: lifted for 240 ticks
// mid-curl. `liftAt`: lifted at that curl progress and never put back. `tilts`: [tick, gamma °].
function thumbScript({ wait = 120, landAt = 'tap', relandAfter = 160, flinch = 0, aim = 0, lapse = false, tilts = [], neverTap = false, liftAt = -1 }) {
  return (run, S, ctl, st) => {
    const t = run.tick;
    if (t === 0) ctl.down();
    for (const [k, g] of tilts) if (t === k) ctl.tilt(g);
    if (lapse && st.lapse === undefined && run.phase === 'ramp' && run.t.progress > 0.4) { st.lapse = t; ctl.up(); }
    if (lapse && t === st.lapse + 240) ctl.down();
    if (liftAt >= 0 && st.lifted === undefined && run.phase === 'ramp' && run.t.progress > liftAt) { st.lifted = t; ctl.up(); }
    if (st.tapped === undefined && !neverTap && onLedge(run)) {
      if (st.ledge === undefined) { st.ledge = t; ctl.up(); }
      if (t === st.ledge + wait) { ctl.down(); st.tapped = t; }
    }
    if (st.tapped >= 0) {
      if (landAt !== 'tap' && t === st.tapped + 20) ctl.up();
      if (landAt !== 'tap' && t === st.tapped + relandAfter) ctl.down();
      if (flinch && run.phase === 'air' && st.flinch === undefined && run.car.vel.y < -4) { st.flinch = t; ctl.up(); }
      if (flinch && t === st.flinch + flinch) ctl.down();
      if (aim && S.released && run.phase === 'air' && IN.thumb.held) {
        if (st.aimNext === undefined || t >= st.aimNext) {
          const o = ctl.sight(t % 2 === 0);
          st.want = [o.x, -o.y]; st.aimAt = t + 48; st.aimNext = t + aim;
        }
        if (t === st.aimAt) ctl.move(st.want[0], st.want[1]);
      }
    }
  };
}
// Classic touch: the stick holds the line on the ground (px from centre), GO to a crawl, BRAKE onto the ledge and
// RELEASE (LIFT) after `wait`; in the air BOOST until the carry, a stick input `trick` ([from, ticks, dx, dy]), LAND
// once falling past `landVy`, BRAKE once down. `releaseAt`: let go early, at that curl progress (a crash). `lineup`:
// the Lineup's lift-off at z −8. `fy`: where on GO/BRAKE the finger sits (Advanced's analog pedals). `crawl`: the
// run-up's speed. `shove`: LAND held on the run-up for those ticks (it boosts there). `sightEvery`: read the sight
// that often in the air, whatever the flight (a crash reads amber and red).
function touchScript({ climb = 4, wait = 100, carry = 7, trick = [0, 0, 0, 0], landVy = -3, releaseAt = 0, lineup = false, fy = 0.5, noLand = false, tilts = [], valves = false, liftBrake = false, crawl = 5.5, shove = [-1, -1], sightEvery = 0 }) {
  return (run, S, ctl, st) => {
    const t = run.tick, c = run.car, v = speed(c);
    for (const [k, g] of tilts) if (t === k) ctl.tilt(g);
    const set = (b, on) => { if (!!st[b] !== on) { st[b] = on; if (on) ctl.press(b, fy); else ctl.release(b); } };
    if (t === 0) ctl.stick(0, 0);
    if (t === shove[0]) set('land', true);
    if (t === shove[1]) set('land', false);
    if (sightEvery && run.phase === 'air' && t % sightEvery === 0) ctl.sight(t % (2 * sightEvery) === 0);
    const ground = run.phase === 'drive' || (run.phase === 'ramp' && !S.released);
    if (ground && st.let === undefined) {
      if (t % 24 === 0) ctl.stick(Math.max(-56, Math.min(56, Math.round(c.pos.x * 30))), 0);
      const want = run.phase === 'drive' ? crawl : climb;
      if (releaseAt && run.phase === 'ramp' && run.t.progress >= releaseAt) {
        set('go', false); set('lift', true); st.let = t;
      } else if (lineup && c.pos.z > -8) {
        set('go', false); set('lift', true); st.let = t;
      } else if (!releaseAt && run.phase === 'ramp' && run.t.progress >= 0.95) {
        set('go', false); set('brk', true);
        if (st.top === undefined && v < 0.3) st.top = t;
        if (st.top >= 0 && t >= st.top + wait) { set('brk', false); set('lift', true); st.let = t; }
      } else { set('go', v < want); set('brk', v > want + 2); }
    } else if (run.phase === 'landed') {
      set('land', false); set('go', false); set('lift', false); set('brk', true);
      if (!st.stickOff) { st.stickOff = true; ctl.stickUp(); }
      if (st.chord >= 0 && st.chordOff === undefined) { st.chordOff = t; ctl.nozzle(0, null); }
    } else if (st.let >= 0) {
      if (t === st.let + (lineup ? 200 : 48)) set('lift', false);
      set('brk', false);
      set('go', -c.vel.z < carry && !run.t.crossedRow && t < st.let + 600);
      const [from, len, dx, dy] = trick;
      if (len && t === st.let + from) ctl.stick(dx, dy);
      if (len && t === st.let + from + len) ctl.stick(0, 0);
      if (!noLand && c.vel.y < landVy && run.phase === 'air') set('land', true);
      // Pro has no brake governor: LIFT by hand, on through a fast fall, off once it's slowed.
      if (liftBrake && t > st.let + 48) set('lift', c.vel.y < landVy || (!!st.lift && c.vel.y < -1));
      if (valves) {
        // Advanced: the nozzle pad. BOOST's chord off the ledge, a thumb rolled from one down-jet to the next,
        // then LIFT's chord to brake the fall.
        if (t === st.let + 30) ctl.nozzle(1, 11);
        if (t === st.let + 150) ctl.nozzle(1, null);
        if (t === st.let + 80) ctl.nozzle(2, 0);
        if (t === st.let + 110) ctl.nozzle(2, 1);
        if (t === st.let + 140) ctl.nozzle(2, -1);
        if (t === st.let + 160) ctl.nozzle(2, null);
        if (st.chord === undefined && c.vel.y < landVy - 2 && run.phase === 'air') { st.chord = t; ctl.nozzle(0, 10); }
      }
    }
  };
}
// A drill flown by hand (0160): the same fingers, from the hand-over. Counted from the tick the drill starts.
// One thumb: a tap on the ledge if there's a ledge to tap (`tapAt`), then held from `holdAt` to the ground.
function drillThumb({ tapAt = -1, holdAt = 40 }) {
  return (run, S, ctl, st) => {
    st.t0 ??= run.tick;
    const k = run.tick - st.t0;
    if (k === tapAt) ctl.down();
    if (k === tapAt + 8) ctl.up();
    if (k === holdAt) ctl.down();
  };
}
// Classic: LAND from `landAt`, or Pro's LIFT by hand under `liftBelow` m; BRAKE once down. `releaseAt`: RELEASE on the ledge.
function drillTouch({ landAt = -1, liftBelow = 0, releaseAt = -1 }) {
  return (run, S, ctl, st) => {
    st.t0 ??= run.tick;
    const k = run.tick - st.t0, c = run.car;
    const set = (b, on) => { if (!!st[b] !== on) { st[b] = on; if (on) ctl.press(b); else ctl.release(b); } };
    if (k === 0) ctl.stick(0, 0);
    if (run.phase === 'landed') { set('land', false); set('lift', false); set('brk', true); return; }
    if (k === landAt) set('land', true);
    if (releaseAt >= 0) set('lift', k >= releaseAt && k < releaseAt + 24);
    if (liftBelow) set('lift', run.phase === 'air' && c.vel.y < -1 && c.pos.y - SPEC.comHeight < liftBelow);
  };
}

export function inputList() {
  return [
    // The drills, flown from their hand-over on the page's controls.
    { name: 'drill-show-ledge-thumb', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard', drill: 'ledge', script: drillThumb({ tapAt: 30, holdAt: 300 }) },
    { name: 'drill-wall-release-thumb', course: 'wall', scheme: 'thumb', tier: 'assist', level: 'standard', drill: 'release', script: drillThumb({ holdAt: 40 }) },
    { name: 'drill-show-carry-thumb', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard', drill: 'carry', script: drillThumb({ holdAt: 60 }) },
    { name: 'drill-show-land-classic', course: 'show', scheme: 'classic', tier: 'assist', level: 'standard', drill: 'land', script: drillTouch({ landAt: 12 }) },
    { name: 'drill-wall-ledge-pro', course: 'wall', scheme: 'classic', tier: 'pro', level: 'standard', drill: 'ledge', script: drillTouch({ releaseAt: 30, liftBelow: 7 }) },
    // One-thumb on the Show: hold, tap and hold; a tap, then held again later with a flinch in the fall; the slide
    // onto the sight; a lapse mid-curl, the tilt on the run-up and a long wait on the ledge.
    { name: 'thumb-show-hold', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({}) },
    { name: 'thumb-show-tap-hold', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ landAt: 'again', wait: 60, flinch: 30 }) },
    { name: 'thumb-show-aim', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ aim: 72 }) },
    { name: 'thumb-show-lapse-tilt', course: 'show', scheme: 'thumb', tier: 'assist', level: 'standard',
      script: thumbScript({ lapse: true, wait: 300, tilts: [[60, 5.5], [150, -4.5], [240, 0]], aim: 60 }) },
    // One-thumb on the Wall: a tap and held again, the slide, and a thumb lifted mid-curl and never put back (a stall).
    { name: 'thumb-wall-hold', course: 'wall', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ landAt: 'again', relandAfter: 200 }) },
    { name: 'thumb-wall-aim', course: 'wall', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ aim: 50, wait: 200 }) },
    // 0177: pressed again in the air 1.25 s after the tap, then the slide onto the sight (the quick read and the hold's floor).
    { name: 'thumb-wall-again-aim', course: 'wall', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ landAt: 'again', relandAfter: 300, aim: 50 }) },
    { name: 'thumb-wall-stall', course: 'wall', scheme: 'thumb', tier: 'assist', level: 'standard', script: thumbScript({ neverTap: true, liftAt: 0.6 }) },
    // Classic touch, Pro: the stick and the pedals on the Show, the Wall and the Lineup.
    { name: 'touch-show-pro', course: 'show', scheme: 'classic', tier: 'pro', level: 'standard', script: touchScript({ trick: [60, 40, 20, -18], liftBrake: true }) },
    { name: 'touch-wall-pro', course: 'wall', scheme: 'classic', tier: 'pro', level: 'standard', script: touchScript({ climb: 5, carry: 0, trick: [30, 50, -25, 10], liftBrake: true, sightEvery: 40 }) },
    { name: 'touch-lineup-pro', course: 'lineup', scheme: 'classic', tier: 'pro', level: 'standard', script: touchScript({ lineup: true, carry: 9, trick: [100, 60, 30, 0], landVy: -2, liftBrake: true }) },
    // Classic touch, Assist: Standard driving with LAND; Easy with the tilt. And Advanced (driving and flight):
    // analog pedals on the ground, the nozzle pad in the air.
    { name: 'touch-show-assist', course: 'show', scheme: 'classic', tier: 'assist', level: 'standard', script: touchScript({ trick: [70, 30, 0, 25] }) },
    { name: 'touch-show-assist-easy', course: 'show', scheme: 'classic', tier: 'assist', level: 'easy',
      script: touchScript({ tilts: [[100, 6], [200, -5], [300, 0]], trick: [80, 30, -40, 0] }) },
    // Easy, flat out down the Lineup's run-up with the phone tilted: its speed-sensitive steering and throttle ellipse
    // past 15 m/s, and LAND held on the run-up (the rear boost).
    { name: 'touch-lineup-easy-fast', course: 'lineup', scheme: 'classic', tier: 'assist', level: 'easy',
      script: touchScript({ lineup: true, crawl: 40, carry: 0, shove: [300, 420], tilts: [[500, 7], [700, -7], [800, 0]], sightEvery: 30 }) },
    { name: 'touch-wall-advanced', course: 'wall', scheme: 'classic', tier: 'advanced', level: 'advanced', script: touchScript({ fy: 0.3, climb: 6, valves: true }) },
    // A crash: let go two thirds up the curl, no LAND. The aftermath brakes the wreck to rest.
    { name: 'touch-show-crash', course: 'show', scheme: 'classic', tier: 'pro', level: 'standard', script: touchScript({ releaseAt: 0.66, noLand: true, carry: 0, sightEvery: 25 }) },
  ];
}
function stringifyInput(v) {
  const { events, sights, log, checks, telemetry, card, ...head } = v;
  const rows = (a) => '[\n' + a.map((x) => JSON.stringify(x)).join(',\n') + '\n]';
  return '{' + Object.entries(head).map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x)}`).join(',') +
    ',\n"events":' + rows(events) + ',\n"sights":' + rows(sights) + ',\n"log":' + rows(log) + ',\n"checks":' + rows(checks) +
    ',\n"telemetry":' + rows(telemetry) + ',\n"card":' + rows(card) + '}\n';
}

// Every file, as { path (relative to VECTOR_DIR): text }. JSON with one case per line so a diff names it.
export function buildVectors({ only } = {}) {
  const files = {};
  const dm = dmathVectors();
  files['dmath.json'] = '{"format":' + dm.format + ',"simVersion":' + dm.simVersion + ',"functions":[\n' +
    dm.functions.map((f) => `{"name":${JSON.stringify(f.name)},"args":${f.args},"cases":[\n` + f.cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]}').join(',\n') + '\n]}\n';
  // The engine on its own (scripts/engine-spike.js): native Rapier must give the WASM build's hash.
  files['engine-spike.json'] = JSON.stringify({ format: VECTOR_FORMAT, steps: [240, 2400].map((n) => ({ steps: n, ...engineSpike(RAPIER, n) })) }) + '\n';
  const flown = [];
  for (const r of runList()) {
    if (only && !only.includes(r.name)) continue;
    const log = r.log(), keep = {};
    files[`runs/${r.name}.json`] = stringifyRun(runVector(r.name, r.course, log, keep));
    flown.push({ name: r.name, course: r.course, log, t: keep.t });
    if (HAPTIC_RUNS.includes(r.name)) {
      const h = hapticFeed(r.name, r.course, log), { ticks, ...head } = h;
      files[`haptics/${r.name}.json`] = JSON.stringify(head).slice(0, -1) + ',"ticks":[\n' + ticks.map((t) => JSON.stringify(t)).join(',\n') + '\n]}\n';
    }
  }
  const touched = [];
  for (const r of inputList()) {
    if (only && !only.includes(r.name)) continue;
    const v = inputVector(r);
    files[`input/${r.name}.json`] = stringifyInput(v);
    touched.push({ name: r.name, course: r.course, log: v.log, fromTick: v.drillStartTick ?? 0 });
  }
  // The app around the sim (0154): every run is needed, so a partial build (`only`) leaves these out.
  if (!only) {
    files['challenge.json'] = lines(challengeVectors(flown));
    files['client.json'] = lines(clientVectors(flown));
    files['coach.json'] = lines(coachVectors([...flown.map((f) => ({ ...f, fromTick: 0 })), ...touched]));
  }
  return files;
}
// A JSON object with one top-level key per line, and each array's items one per line, so a diff names the case.
function lines(o) {
  return '{' + Object.entries(o).map(([k, v]) => `\n${JSON.stringify(k)}:` + (Array.isArray(v) ? '[\n' + v.map((x) => JSON.stringify(x)).join(',\n') + '\n]' : JSON.stringify(v))).join(',') + '\n}\n';
}
function stringifyRun(v) {
  const { log, checks, full, telemetry, card, ...head } = v;
  const rows = (a) => '[\n' + a.map((x) => JSON.stringify(x)).join(',\n') + '\n]';
  return '{' + Object.entries(head).map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x)}`).join(',') +
    ',\n"log":' + rows(log) + ',\n"checks":' + rows(checks) + ',\n"full":' + rows(full) +
    ',\n"telemetry":' + rows(telemetry) + ',\n"card":' + rows(card) + '}\n';
}

// --- the app around the sim (0154, docs/NATIVE.md §7) ---------------------------------------------
// challenge.json: src/challenge.js's `#vs=` payloads, byte for byte: the plain ('r') form of real runs, a legacy
// 12-channel log, odd inputs, coarsened logs, payloads that must decode to null, the fragment parser, the URL and
// compare(). The deflated ('z') form isn't pinned: deflate's bytes depend on the zlib build (Node's differs by CPU),
// so the Swift side checks its own round trip, and tests/unit/vectors.test.js decodes every case with the real
// decodeChallenge.
const CH_RUNS = ['ref-show', 'ref-wall', 'ref-lineup', 'ref-show-advanced', 'crash-lineup-rolls2', 'pro-fuzz-0', 'pro-fuzz-1', 'naive-wall-floored-1-1.01'];
const rPayload = (o) => `r${toB64url(packBytes(o))}`;
// The 'r' half of decodeChallenge, synchronously: a reject below that this accepts is a bug in the golden.
function decodeR(p) {
  try {
    if (typeof p !== 'string' || p.length < 2 || p.length > VS_MAX_CHARS || p[0] !== 'r') return null;
    const b = fromB64url(p.slice(1));
    return b && b.length ? unpackBytes(b) : null;
  } catch { return null; }
}
export function challengeVectors(flown) {
  const cases = [];
  CH_RUNS.forEach((name, i) => {
    const f = flown.find((x) => x.name === name);
    if (!f) return;
    const card = scoreRun(f.t), initials = i % 2 ? '' : ['ABC', 'XYZ', 'QQQ', 'MAZ'][i / 2];
    cases.push({ name, course: f.course, score: card.total, tier: card.tier, initials, simVersion: SIM_VERSION, log: f.log,
      payload: rPayload({ log: f.log, course: f.course, score: card.total, tier: card.tier, initials }) });
  });
  // An older client's 12-channel log: packed as today's 23 (the missing channels zero).
  const lineup = flown.find((x) => x.name === 'ref-lineup');
  if (lineup) {
    const log = lineup.log.map((e) => e.slice(0, 13));
    cases.push({ name: 'legacy-12', course: 'lineup', score: 91.25, tier: 'pro', initials: 'OLD', simVersion: SIM_VERSION, log,
      payload: rPayload({ log, course: 'lineup', score: 91.25, tier: 'pro', initials: 'OLD' }) });
  }
  // Odd inputs packBytes tolerates: a score out of range, an unknown tier, bad initials, an older SIM_VERSION, values past ±100.
  const zeros = (n) => new Array(n).fill(0);
  const tiny = [[0, 100, ...zeros(CHANNELS - 1)], [7, 100, 0, -35, ...zeros(CHANNELS - 3)], [300, ...zeros(CHANNELS)]];
  for (const [name, o] of [['score-high', { score: 140, tier: 'advanced', initials: 'TOP' }], ['score-neg', { score: -3, tier: 'nope', initials: 'abc' }],
    ['score-half', { score: 87.25, tier: 'pro', initials: 'AB' }], ['old-sim', { score: 50.05, simVersion: 3 }],
    ['clamped', { score: 12, log: [[0, 150, -250, ...zeros(CHANNELS - 2)]] }]]) {
    const log = o.log || tiny;
    cases.push({ name, course: 'wall', score: o.score, tier: o.tier ?? 'assist', initials: o.initials ?? '', simVersion: o.simVersion ?? SIM_VERSION, log,
      payload: rPayload({ log, course: 'wall', score: o.score, tier: o.tier, initials: o.initials, simVersion: o.simVersion }) });
  }
  // Decoded, as decodeChallenge returns them (the score to one decimal, the log padded to 23, clamped to ±100).
  for (const c of cases) {
    const d = decodeR(c.payload);
    if (!d) throw new Error(`challenge golden: ${c.name} does not decode`);
    c.decoded = { simVersion: d.simVersion, course: d.course, score: d.score, tier: d.tier, initials: d.initials, log: c.name === 'clamped' || c.name === 'legacy-12' ? d.log : null };
  }
  // coarsen(): the shorter link's logs, packed.
  const coarse = [];
  for (const name of ['ref-show', 'pro-fuzz-0']) {
    const f = flown.find((x) => x.name === name);
    if (f) for (const step of COARSE_STEPS) { const log = coarsen(f.log, step); coarse.push({ name, step, entries: log.length, payload: rPayload({ log, course: f.course, score: 80, tier: 'assist' }) }); }
  }
  // Payloads that must decode to null: each breaks one bound.
  const head = (o = {}) => [o.format ?? 1, o.sim ?? SIM_VERSION, o.course ?? 0, ...(o.score ?? [0x84, 0x07]), o.tier ?? 1, ...(o.ini ?? [65, 66, 67])];
  const varint = (n) => { const out = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return out; };
  const entry = (delta, chans) => [...varint(delta), ...chans];
  const body2 = [2, ...entry(0, [0x80, ...varint(200)]), ...entry(10, [0x80, ...varint(199)])];   // throttle 100, then 0
  const ok = [...head(), ...body2];
  const bad = (name, bytes) => ({ name, payload: `r${toB64url(Uint8Array.from(bytes))}` });
  const rejects = [
    bad('trailing byte', [...ok, 0]),
    bad('format 2', [2, ...ok.slice(1)]),
    bad('course 3', [...head({ course: 3 }), ...body2]),
    bad('score 1001', [...head({ score: varint(1001) }), ...body2]),
    bad('tier 3', [...head({ tier: 3 }), ...body2]),
    bad('initials half', [...head({ ini: [65, 66, 0] }), ...body2]),
    bad('initials lower', [...head({ ini: [97, 98, 99] }), ...body2]),
    bad('no entries', [...head(), 0]),
    bad('entries past MAX_TICKS', [...head(), ...varint(21601)]),
    bad('tick past MAX_TICKS', [...head(), 1, ...entry(21600, [0xff])]),
    bad('tick delta 0', [...head(), 2, ...entry(0, [0x80, ...varint(200)]), ...entry(0, [0x80, ...varint(199)])]),
    bad('channel 23', [...head(), 1, ...entry(0, [23 | 0x80, 2])]),
    bad('channel twice', [...head(), 1, ...entry(0, [0, 2, 0x80, 2])]),
    bad('value 101', [...head(), 1, ...entry(0, [0x80, ...varint(202)])]),
    bad('value unchanged', [...head(), 1, ...entry(0, [0x80, 0])]),
    bad('zigzag past 400', [...head(), 1, ...entry(0, [0x80, ...varint(401)])]),
    bad('truncated', ok.slice(0, ok.length - 1)),
    bad('varint too long', [1, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]),
    { name: 'kind q', payload: `q${toB64url(Uint8Array.from(ok))}` },
    { name: 'kind only', payload: 'r' },
    { name: 'empty', payload: '' },
    { name: 'bad base64', payload: 'rAB!C' },
    { name: 'base64 length 4n+1', payload: 'rABCDE' },
    { name: 'non-ascii', payload: 'rABéC' },
    { name: 'too long', payload: `r${'A'.repeat(VS_MAX_CHARS)}` },
  ];
  for (const r of rejects) if (decodeR(r.payload)) throw new Error(`challenge golden: reject "${r.name}" decodes`);
  const twin = `r${toB64url(Uint8Array.from(ok))}`, td = decodeR(twin);
  if (!td) throw new Error('challenge golden: the rejects\' good twin does not decode');
  const accept = [{ name: 'the rejects\' good twin', payload: twin, decoded: td }];
  const hashes = ['#vs=rAbC_-9', '#x=1&vs=zQQ&y=2', '#vsx=1', '', '#vs=', '#play&vs=AB', 'vs=abc', '#vs=ab$cd', '#&vs=Q', '#avs=Q', `#vs=${'A'.repeat(VS_MAX_CHARS + 13)}`]
    .map((h) => [h, vsFromHash(h)]);
  const urls = [['https://mutaafaziz.com/coldgas/', 'show', 'rABC'], ['https://mutaafaziz.com/coldgas/', 'lineup', 'zQ-_'], ['/coldgas/', 'a b&c/é', 'r0']]
    .map(([b, c, p]) => [b, c, p, challengeUrl(b, c, p)]);
  const compares = [[90, 88.5, 'ABC'], [88.5, 90, ''], [90, 90, 'ABC'], [90.04, 90, ''], [90.06, 90, 'XYZ'], [0.3, 0.1 + 0.2, ''], [97.7, 12.3, 'Q'], [12.3, 97.7, 'MAZ'], [50.05, 50, '']]
    .map(([a, b, i]) => [a, b, i, compare(a, b, i)]);
  return { format: VECTOR_FORMAT, simVersion: SIM_VERSION, channels: CHANNELS, maxChars: VS_MAX_CHARS, cases, coarse, accept, rejects, hashes, urls, compares };
}

// client.json: the numbers and words the app shows or sends, from the web's own modules: JSON.stringify of each run's
// telemetry (the board's and the judges' `t`) and of the request bodies, JS number → string (shortest, as String(x) and
// JSON write it) and toFixed, src/units.js's readouts and prose, src/panel.js's local lines, boardRow, postMessage and
// rankLabel, and src/daily.js's objectives, checks, hints and streak.
const NUM_SPECIAL = [0, -0, 1, -1, 0.1, 0.5, 1 / 3, 2 / 3, 100, 1e21, 1e20, 123456789012345680000, 1.5e21, 1e-6, 1e-7, 1.5e-7, 0.000001234,
  5e-324, -5e-324, 1.7976931348623157e308, 2.2250738585072014e-308, 4.35, 0.817, 27.4, 9007199254740993, 1e16, 12345678901234567, 9007199254740992,
  0.30000000000000004, -1e-7, 1e100, 123e-20, 1e15 + 0.3, 999999999999999900000, 0.000001, 0.0000015, 297, -273.15, 2447 / 2150, Math.PI, Math.E,
  Infinity, -Infinity, NaN];
const FIXED_SPECIAL = [0.5, 1.5, 2.5, -2.5, -0.5, 0.125, 0.375, 1.005, 1.45, 8.345, 1234.5, 999.95, -0.4, -0, 0, 0.05, 1e-10, 123456.789, 0.045, 10.235,
  1.0000000000000002, 99.99999999999999, 5e-324, 1e20, 4.35, 0.817, 27.35, -1234.5678];
const UNIT_SI = [0, 0.5, 1, 3.5, 7, 12.345, 26.8224, 99.95, 1609.344, 1234.5, 98765.4, -3.2, 0.0254, 160, 161, 16093, 16094, 1e6];
const PROSE = ['27.7 m up the wall', 'Touchdown at 0.8 m/s with 3.2° of tilt.', '1,234 kg of gas', '78 kN down-jets', '−3 m', '-2.5 m/s', 'at 12 km/h',
  'a 9.81 m/s² pull', '4 metres', '250 bar', '120 kW', '3 cm and 45 mm', '10m', '5 m', 'x1.5 m', '1.5 m/s²', '20 mph', '3 ms', 'm2', '1.5 km',
  '1,000,000 m', '0.25 m', '2,447 kgf', '0.05 bar', 'two meters', '12.5 meter', '+4 m', '1.2.3 m', '9 m/sx', '7 m²', '80 kN, 78 kN and 297 kg',
  '0.2 mm', '12,5 m', '3 m_', 'é4 m', '1500 kg', '1500.5 kg', '33 m/s', '0.123 km'];
const CTXS = [{ device: 'touch', scheme: 'thumb', tier: 'assist' }, { device: 'touch', scheme: 'classic', tier: 'assist' }, { device: 'touch', scheme: 'classic', tier: 'pro' },
  { device: 'touch', scheme: 'classic', tier: 'advanced' }, { device: 'pad', scheme: 'classic', tier: 'assist' }, { device: 'key', scheme: 'classic', tier: 'pro' }];
// Cards the runs don't reach, for the local lines' and the Daily's other branches: a real card with its facts bent.
const BENDS = [['wrecked', { damagePct: 72 }], ['no-jump', { jumped: false, progressPct: 64 }], ['no-climb', { jumped: false, progressPct: 20 }],
  ['contact', { contact: true }], ['flipped', { flipped: true }], ['crashed', { crashed: true }], ['fell-off', { fellOff: true }],
  ['on-ramp', { landedOnRamp: true }], ['short', { crossedRow: false }], ['double', { rotations: 2, rollDeg: 731 }], ['zero-rot', { rotations: 0 }],
  ['soft', { sink: 0.6, wheelSpreadMs: 12 }], ['hard', { sink: 2.4, wheelSpreadMs: 180, airPct: 12 }], ['long-inverted', { invertedS: 1.4 }],
  ['near', { padMiss: 2.9, clearance: 1.2, airPct: 31, damagePct: 0 }], ['far', { padMiss: 9.6, clearance: 3.4, airPct: 22, damagePct: 4 }]];
const cardOf = (c) => ({ total: c.total, verdict: c.verdict, tier: c.tier, facts: c.facts });
export function clientVectors(flown) {
  const r = xorshift(0x5eed0154), u = () => r() / U32;
  const ten = (k) => Number(`1e${k}`);   // parsed, not Math.pow: engines differ in pow by an ulp, and these files must not
  const nums = NUM_SPECIAL.slice();
  for (let i = 0; i < 300; i++) nums.push(unhex(r().toString(16).padStart(8, '0') + r().toString(16).padStart(8, '0')));
  for (let i = 0; i < 300; i++) { const m = ten((r() % 9) - 3); nums.push(Math.round((u() * 2 - 1) * 1e5 * m) / (1e5 / m)); }
  for (let i = 0; i < 100; i++) nums.push((u() * 2 - 1) * ten((r() % 50) - 25));
  const numbers = nums.map((x) => [hex(x), String(x), JSON.stringify(x)]);
  const fixed = [];
  for (const x of FIXED_SPECIAL) for (let d = 0; d <= 3; d++) fixed.push([hex(x), d, x.toFixed(d)]);
  for (let i = 0; i < 400; i++) { const x = Math.round((u() * 2 - 1) * ten(r() % 7) * 1000) / 1000 + (r() & 1 ? 0.0005 : 0); const d = r() % 4; fixed.push([hex(x), d, x.toFixed(d)]); }
  const telemetry = flown.map((f) => [f.name, JSON.stringify(f.t)]);
  const lu = flown.find((f) => f.name === 'ref-lineup');
  const bodies = lu ? [
    ['post', JSON.stringify({ log: lu.log, t: lu.t, initials: 'ABC', course: lu.course })],
    ['dry', JSON.stringify({ log: lu.log, t: lu.t, course: lu.course, dry: true })],
    ['judges', JSON.stringify({ log: lu.log, t: lu.t, assist: true, course: lu.course, provider: EDGE_DEFAULT.provider, model: EDGE_DEFAULT.model })],
  ] : [];
  const units = [];
  for (const q of ['speed', 'rate', 'len', 'mass', 'kgf', 'press', 'dist', 'force']) for (const si of UNIT_SI) for (const d of [0, 1, 2]) for (const s of ['us', 'metric']) units.push([q, hex(si), d, s, one(q, si, d, s)]);
  const cards = [];
  for (const f of flown) {
    const card = scoreRun(f.t);
    cards.push([f.name, f.course, card]);
    if (['ref-show', 'ref-wall', 'ref-lineup'].includes(f.name)) for (const [bend, facts] of BENDS) cards.push([`${f.name}~${bend}`, f.course, { ...card, facts: { ...card.facts, ...facts } }]);
  }
  const words = cards.map(([name, course, card]) => [name, course, cardOf(card), localWords(card)]);
  // Everything with a unit in it, with each system leading (setUnits is the module's own state: put back after).
  const was = getUnits();
  const prose = [], goals = [], daily = [], readouts = [];
  for (const s of ['us', 'metric']) {
    setUnits(s, { persist: false });
    for (const m of UNIT_SI) readouts.push([s, hex(m), fmtRoad(m), fmtSmall(m), both('len', m, { us: 0, metric: 1 }), both('speed', m)]);
    for (const t of [...PROSE, ...words.flatMap(([, , , w]) => [w.engineer, w.coordinator, w.designer])]) prose.push([s, t, toUS(t), localize(t)]);
    for (const o of OBJECTIVES) goals.push([s, o.id, o.goal()]);
    for (const o of OBJECTIVES) for (const [name, course, card] of cards) {
      const res = evaluate(o, card, course);
      if (res) daily.push([s, o.id, name, res.ok, res.miss, !!res.fix, ...(res.ok ? [] : CTXS.map((c) => missLine(o, res, { ...c, course })))]);
    }
  }
  setUnits(was, { persist: false });
  const titles = OBJECTIVES.flatMap((o) => CTXS.map((c) => [o.id, c, titleHint(o, c, false), titleHint(o, c, true)]));
  const days = [];
  for (let d = EPOCH - 40; d <= EPOCH + 1500; d++) days.push([d, objectiveIndex(d)]);
  const dayKeys = [0, 1, 86_399_999, 86_400_000, Date.UTC(2026, 0, 1), Date.UTC(2026, 10, 4, 23, 59, 59), Date.UTC(2028, 1, 29, 12), -1, -86_400_001]
    .map((ms) => [ms, dayNumber(ms), dayKey(ms)]);
  const noon = (s) => Date.parse(`${s}T12:00:00Z`);
  let st = readStreak(null);
  const streak = [];
  for (const day of ['2026-11-01', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-12-31', '2027-01-01', '2027-01-02']) {
    const ms = noon(day), before = streakNow(st, ms);
    st = complete(st, ms);
    streak.push([day, ms, before, st, streakNow(st, ms), streakNow(st, ms + 86_400_000), streakNow(st, ms + 2 * 86_400_000)]);
  }
  const streakReads = [null, '', 'junk', '{}', '{"last":"2026-11-03","streak":4,"best":2}', '{"last":"2026-13-40","streak":4}', '{"last":"2026-11-03","streak":-1,"best":1.5}',
    '{"last":"2026-11-03","streak":100000,"best":7}', '{"last":"2026-11-03"}', '[1]', '{"last":"2026-11-03","streak":"3","best":9}', '{"last":"2026-02-30","streak":2}']
    .map((raw) => [raw, readStreak(raw)]);
  const rows = [null, 5, 'row', {}, { total: '88.5' }, { total: null }, { total: 'abc' }, { total: true },
    { total: 90, initials: 'ab1c', verdict: 'x'.repeat(50), facts: { rollDeg: '360', sink: null }, tier: 'pro', course: 'wall' },
    { total: 70, initials: '', tier: 'bogus', course: 'moon', verdict: '' }, { total: 0, facts: [1, 2], initials: 123 },
    { total: 100, initials: 'éAB', verdict: 12, facts: { rollDeg: 720.4, sink: 0.82 } },
    { total: 64.2, initials: true, verdict: null, tier: 'advanced', course: 'lineup', facts: 'x' }, { total: ' 12 ', initials: { a: 1 }, facts: { sink: '' } },
    { initials: 'ABC', total: 1e3, verdict: 'Stuck it', facts: { rollDeg: -5, sink: 'Infinity' }, tier: 'assist', course: 'show', day: '2026-11-04' },
    { total: '0x1A', initials: 'zz' }, { total: '1e2', initials: 'a-b-c-d' }, { total: '', verdict: false }]
    .map((x) => [x, boardRow(x)]);
  const posts = [{ ok: true, rank: 3 }, { ok: false, status: 429 }, { ok: false, status: 0, timeout: true }, { ok: false, status: 0 }, { ok: false, status: 400, error: 'update' },
    { ok: false, status: 400, error: 'no jump' }, { ok: false, status: 400, error: 'implausible', why: 'air' }, { ok: false, status: 400, error: 'bad run' },
    { ok: false, status: 400, error: 'initials' }, { ok: false, status: 400, error: 'course' }, { ok: false, status: 503, error: 'no board' }, { ok: false, status: 500 },
    { ok: false, status: 429, error: 'slow down' }]
    .map((x) => [x, postMessage(x)]);
  const ranks = [1, 7, 0, -2, 1.5, null, '3'].map((x) => [x, rankLabel(x)]);
  return { format: VECTOR_FORMAT, simVersion: SIM_VERSION, numbers, fixed, telemetry, bodies, units, readouts, prose, words, localWhy: [LOCAL_WHY],
    objectives: OBJECTIVES.map((o) => [o.id, o.course, o.tier ?? null]), epoch: EPOCH, days, dayKeys, goals, daily, titles, streak, streakReads, rows, posts, ranks };
}

// --- the coach (0160) ------------------------------------------------------------------------------
// coach.json: src/sim/coach.js, src/pointer.js coachWords and src/practice.js over the same logs the sim's vectors fly
// (every run and input vector), with the words a phone gets. An item: [id, weight bits, title, detail, fix], in order.
const itemRow = (it) => [it.id, it.weight === undefined ? null : hex(it.weight), it.title, it.detail, it.fix];
const itemRows = (items) => items.map(itemRow);
const COACH_DEVICES = ['touch', 'key', 'pad'], COACH_SCHEMES = ['thumb', 'classic'], COACH_TIERS = ['assist', 'pro', 'advanced'];
// src/main.js pointerCtx and flownCtx's scheme, which can't load in Node (tests/unit/vectors.test.js pins the line it mirrors).
export const schemeFor = (device, touchScheme, course, tier) => (device === 'touch' && touchScheme === 'thumb' && tier === 'assist' ? 'thumb' : 'classic');   // 0181: the Lineup too
// What a drill's tail does after the hand-over, data the Swift test reads and flies the same way:
// a push-off if it starts on the ledge, LAND from tick `level`, BOOST until tick `thrust`, assist 0 or 1, LIFT until tick
// `liftHold` and below `liftBelow` m, a roll and a pitch input from `rollAt`/`pitchAt` for `rollLen`/`pitchLen` ticks.
const TAIL = { level: -1, thrust: 0, assist: 1, liftBelow: 0, liftHold: 0, rollAt: -1, rollLen: 0, roll: 0, pitchAt: -1, pitchLen: 0, pitch: 0 };
const DRILL_TAILS = [
  { ...TAIL, name: 'idle' },
  { ...TAIL, name: 'land', level: 0 },
  { ...TAIL, name: 'boost-land', level: 90, thrust: 90 },
  { ...TAIL, name: 'pro-late', thrust: 60, assist: 0, liftBelow: 5 },
];
// Flights the four above don't reach, found by search: each makes the coach say something nothing else makes it say.
const DRILL_PROBES = [
  ['ledge', 'show', { ...TAIL, name: 'late-roll', assist: 0, level: 150, liftBelow: 3, rollAt: 200, rollLen: 120, roll: 1, pitchAt: 200, pitchLen: 300, pitch: 1 }],
  ['land', 'wall', { ...TAIL, name: 'over-roll', level: 200, thrust: 400, liftBelow: 8, rollAt: 120, rollLen: 500, roll: -1 }],
  ['release', 'wall', { ...TAIL, name: 'late-land', level: 60, thrust: 400, liftBelow: 3, pitchAt: 200, pitchLen: 30, pitch: -1 }],
  ['land', 'show', { ...TAIL, name: 'ran-out', assist: 0, liftHold: 200 }],
  ['land', 'wall', { ...TAIL, name: 'gas', assist: 0, liftHold: 1400 }],
];
function tailInput(inp, run, drill, k, tail) {
  const c = run.car;
  Object.assign(inp, newInput());
  inp.fan = 0; inp.assist = tail.assist;
  if (run.phase === 'landed') { inp.brake = 1; return inp; }
  if (!drill.released && k < 24) inp.lift = 1;
  if (k < tail.thrust) inp.thrust = 1;
  if (k < tail.liftHold) inp.lift = 1;
  if (tail.rollAt >= 0 && k >= tail.rollAt && k < tail.rollAt + tail.rollLen) inp.roll = tail.roll;
  if (tail.pitchAt >= 0 && k >= tail.pitchAt && k < tail.pitchAt + tail.pitchLen) inp.pitch = tail.pitch;
  if (tail.level >= 0 && k >= tail.level && run.phase === 'air') inp.level = 1;
  if (tail.liftBelow && run.phase === 'air' && c.vel.y < -1 && c.pos.y - SPEC.comHeight < tail.liftBelow) inp.lift = 1;
  return inp;
}
const logHash = (log) => { const h = [0x811c9dc5, 0x9747b28c]; for (const e of log) mixState(h, e); return hashHex(h); };
const DRILL_BEAT = 120;   // main.js: a drill's moment flies on for 0.5 s before its aftermath
function drillVector(drill, course, tail, thumb, classic) {
  const { run, released } = buildDrill(drill, course);
  const startTick = run.drillStartTick, handover = stateOf(run).map(hex), prefix = { entries: run.inputLog.length, hash: logHash(run.inputLog) };
  armAftermath(run);
  const inp = newInput();
  let beat = 0;
  while (run.phase !== 'done' && beat < DRILL_BEAT) {
    if (drill.done && drill.done(run)) beat++;
    stepRun(run, tailInput(inp, run, drill, run.tick - startTick, tail));
  }
  const card = scoreRun(run.t), result = drillResult(drill, run, card), own = drillCoach(drill, run);
  const flew = { ticks: run.tick, phase: run.phase, state: stateOf(run).map(hex), telemetry: flat(run.t), card: flat(card) };
  const log = run.inputLog.map((e) => e.slice());
  const after = { ticks: 0, state: null };
  for (let done = false; !done;) done = aftermathStep(run);
  after.ticks = run.after.ticks; after.state = stateOf(run).map(hex);
  return {
    drill: drill.id, course, tail, released, startTick, handover, prefix, ...flew, log: { entries: log.length, hash: logHash(log) }, after,
    result: { pass: !!result.pass, headline: result.headline, stats: result.stats.map(([text, flag]) => [text, !!flag]) },
    own: own && itemRows(own),
    thumb: itemRows(coach(log, course, card, startTick, thumb).items),
    classic: itemRows(coach(log, course, card, startTick, classic).items),
  };
}
const MISS_GRID = [-30, -7.04, -0.51, -0.5, -0.49, -0.04, 0, 0.04, 0.49, 0.5, 3.25, 3.3, 12];
export function coachVectors(logs) {
  const words = [['KEY_WORDS', '', '', KEY_WORDS]];
  for (const device of COACH_DEVICES) for (const scheme of COACH_SCHEMES) for (const tier of COACH_TIERS) words.push([device, scheme, tier, coachWords({ device, scheme, tier })]);
  const ctxs = [];
  for (const device of COACH_DEVICES) for (const scheme of COACH_SCHEMES) for (const course of ['show', 'wall', 'lineup']) for (const tier of COACH_TIERS) ctxs.push([device, scheme, course, tier, schemeFor(device, scheme, course, tier)]);
  const misses = [['null', null, true, markMiss(null, true)]];
  for (const along of MISS_GRID) for (const x of MISS_GRID) for (const show of [true, false]) misses.push([hex(along), hex(x), show, markMiss({ along, x }, show)]);
  const names = [];
  for (const padMiss of [0, 3, 7, 7.01]) for (const cost of [0, 2.9, 3]) for (const show of [true, false]) for (const drill of [true, false]) names.push(['mark', hex(padMiss), hex(cost), show, drill, namesMark(padMiss, cost, { show, drill })]);
  for (const sink of [0.5, 1.5, 1.51, 2.9, 3, 4]) for (const cost of [0, 2.9, 3]) for (const show of [true, false]) for (const drill of [true, false]) names.push(['brake', hex(sink), hex(cost), show, drill, namesBraking(sink, cost, { show, drill })]);

  const thumb = coachWords({ device: 'touch', scheme: 'thumb', tier: 'assist' });
  const flights = [], rows = [];
  for (const { name, course, log, fromTick } of logs) {
    const { run, flight } = readFlight(log, course, fromTick);
    const { t, ...read } = flight, card = scoreRun(run.t);
    const classic = coachWords({ device: 'touch', scheme: 'classic', tier: card.tier });
    flights.push([name, course, fromTick, hex(markCost(run.t)), hex(sinkCost(run.t)), flat(read)]);
    const asClassic = coach(log, course, card, fromTick, classic).items;
    rows.push([name, 'thumb', true, itemRows(coach(log, course, card, fromTick, thumb).items)]);
    rows.push([name, 'classic', true, itemRows(asClassic)]);
    // With no card only a clean run's words change; the keyboard's are the default.
    if (asClassic[0].id === 'clean' || name.startsWith('ref-')) rows.push([name, 'key', false, itemRows(coach(log, course).items)]);
  }
  const drills = [];
  const thumbWords = thumb, classicWords = coachWords({ device: 'touch', scheme: 'classic', tier: 'assist' });
  for (const drill of DRILLS) for (const course of drill.courses) for (const tail of DRILL_TAILS) drills.push(drillVector(drill, course, tail, thumbWords, classicWords));
  for (const [id, course, tail] of DRILL_PROBES) drills.push(drillVector(drillById(id), course, tail, thumbWords, classicWords));
  return { format: VECTOR_FORMAT, simVersion: SIM_VERSION, words, ctxs, misses, names, flights, rows, drills };
}
