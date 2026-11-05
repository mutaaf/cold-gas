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
export function runVector(name, course, log) {
  const h = [0x811c9dc5, 0x9747b28c], checks = [], full = [];
  const run = simulate(log, course, undefined, (r) => {
    const s = stateOf(r);
    mixState(h, s);
    if (r.tick % CHECK_EVERY === 0) checks.push([r.tick, hashHex(h)]);
    if (r.tick % FULL_EVERY === 0) full.push([r.tick, s.map(hex)]);
  });
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
export function inputVector({ name, course, scheme, tier, level, script }) {
  dom.fresh();
  IN.setDriving({ level });
  const run = armAftermath(createRun(course));
  const S = { released: false, releaseTick: -1 };
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
      markOffset(c, pr, course, off);
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
    format: VECTOR_FORMAT, simVersion: SIM_VERSION, name, course, scheme, tier, level, ticks, releaseTick: S.releaseTick, endReason: run.t.endReason, final,
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

export function inputList() {
  return [
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
  for (const r of runList()) {
    if (only && !only.includes(r.name)) continue;
    const log = r.log();
    files[`runs/${r.name}.json`] = stringifyRun(runVector(r.name, r.course, log));
    if (HAPTIC_RUNS.includes(r.name)) {
      const h = hapticFeed(r.name, r.course, log), { ticks, ...head } = h;
      files[`haptics/${r.name}.json`] = JSON.stringify(head).slice(0, -1) + ',"ticks":[\n' + ticks.map((t) => JSON.stringify(t)).join(',\n') + '\n]}\n';
    }
  }
  for (const r of inputList()) {
    if (only && !only.includes(r.name)) continue;
    files[`input/${r.name}.json`] = stringifyInput(inputVector(r));
  }
  return files;
}
function stringifyRun(v) {
  const { log, checks, full, telemetry, card, ...head } = v;
  const rows = (a) => '[\n' + a.map((x) => JSON.stringify(x)).join(',\n') + '\n]';
  return '{' + Object.entries(head).map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x)}`).join(',') +
    ',\n"log":' + rows(log) + ',\n"checks":' + rows(checks) + ',\n"full":' + rows(full) +
    ',\n"telemetry":' + rows(telemetry) + ',\n"card":' + rows(card) + '}\n';
}
