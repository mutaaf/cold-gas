// The sim's golden traces for the native port (docs/NATIVE.md §3, ticket 0146). The Swift core
// (ios/Packages/ColdGasCore) replays every file this writes and must match it bit for bit:
// numbers are stored as their IEEE 754 bit patterns (16 hex digits, big-endian), never as decimals.
// Pure and deterministic: same bytes on every machine and every run (no Math.random, no clock).
// scripts/vectors.mjs writes or checks the files; tests/unit/vectors.test.js checks a sample.
import { createRun, stepRun, simulate, wallProgress, SIM_VERSION } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { newInput } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { dsin, dcos, datan, datan2, dacos, dhypot, dexp, dlog } from '../src/sim/dmath.js';

export const VECTOR_FORMAT = 1;
export const VECTOR_DIR = 'ios/Packages/ColdGasCore/Tests/Vectors';
export const CHECK_EVERY = 24;     // a cumulative state hash every 24 ticks (0.1 s)
export const FULL_EVERY = 240;     // the full state every 240 ticks (1 s), to name the field that differs

// --- bits ------------------------------------------------------------------------------------
const dv = new DataView(new ArrayBuffer(8));
export function hex(x) {
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
    dv.setFloat64(0, v);
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

// Every file, as { path (relative to VECTOR_DIR): text }. JSON with one case per line so a diff names it.
export function buildVectors({ only } = {}) {
  const files = {};
  const dm = dmathVectors();
  files['dmath.json'] = '{"format":' + dm.format + ',"simVersion":' + dm.simVersion + ',"functions":[\n' +
    dm.functions.map((f) => `{"name":${JSON.stringify(f.name)},"args":${f.args},"cases":[\n` + f.cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]}').join(',\n') + '\n]}\n';
  for (const r of runList()) {
    if (only && !only.includes(r.name)) continue;
    files[`runs/${r.name}.json`] = stringifyRun(runVector(r.name, r.course, r.log()));
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
