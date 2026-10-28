// Driving levels (0066): one setting, Easy / Standard / Advanced, for the ground in every mode. It sits
// between the devices (src/input.js) and the sim, and only ever writes the ordinary input channels
// (steer, throttle, brake; and on an unscored ground, assist/manual): a scored run's log replays in the
// frozen Worker exactly as it was driven, whatever level drove it. Pure, no DOM, allocation-free per
// tick, so the drive bench (scripts/drive-feel.mjs) and the unit tests drive through the same layer.
//
//   Standard  today's hands (src/hands.js), bit for bit.
//   Easy      speed-sensitive steering, a softer stick, a gentle throttle held inside the friction
//             ellipse, a slide catch; on a road a cornering-speed governor (the road's curvature over the
//             braking distance ahead) and a lane-keeping nudge near the edge.
//   Advanced  direct: no hands filter, a linear stick, analog pedals (gamepad triggers, the touch pads
//             by slide); unscored: ESC off, TC On / Sport / Off, ABS On / Off, a handbrake.
//
// AI drive (0109), Free Drive's roads and the endless road only (it needs `ctx.road`: never a scored run,
// never the Sandbox's open arena): over any level, the computer drives the line and the player gives intent.
// It steers along the lane by pure pursuit (src/drive/pilot.js's geometry, the whole road through a
// hairpin), takes the bend ahead no faster than its tyres allow, catches slides, and drives a stock car
// with stability control. GO is the pace (more GO, faster; never past the safe speed), BRAKE slows and
// stops; steer moves the car across the road (a lane change, or to the edge to pull over) and a hard,
// sustained steer takes the wheel, inside the road's edges. Still only the ordinary input channels.
import { createHands, stickShape } from './hands.js';
import { SPEC } from './sim/spec.js';
import { G } from './sim/vehicle.js';

export const LEVELS = ['easy', 'standard', 'advanced'];
export const LEVEL_INFO = {
  easy: { name: 'Easy', blurb: 'Brakes for the bend ahead, keeps you on the road, catches slides. A soft stick and a gentle throttle.' },
  standard: { name: 'Standard', blurb: 'Assist driving: speed-sensitive steering, stability and traction control.' },
  advanced: { name: 'Advanced', blurb: 'Direct steering and pedals, analog on triggers and touch. Free Drive: ESC off, TC and ABS your call, H handbrake.' },
};
// The name. "AI assist" is the flight tier (src/main.js, the top bar's Assist chip, the coach, 0079): the flight
// computer flies the jets and you fly the intent, and it is on screen in Free Drive too (the jets fly there). This
// is the same idea on the road, so it shares the word AI and the switch-like control, but not the name: two
// "AI assist" controls on one screen doing different things would be one too many. (Its words: src/drive/hud.js.)
export const TC_MODES = ['on', 'sport', 'off'];
export const validLevel = (l) => (LEVELS.includes(l) ? l : null);
// Every device starts on Standard, the feel every gate was tuned on (0074: phones started on Easy before;
// a saved choice is still the player's). Easy is one tap away: the Controls sheet, or the results' Rookie
// mode after three crashes in a row (src/rookie.js). Callers still pass the pointer kind; it no longer matters.
export const defaultLevel = () => 'standard';

// The stick on the ground, per level and kind ('touch' | 'pad'). Standard is exactly what input.js did.
export function shapeStick(level, x, kind = 'pad') {
  if (level === 'advanced') return stickShape(x, kind === 'touch' ? 0.08 : 0.06, 0);
  if (level === 'easy') return stickShape(x, kind === 'touch' ? 0.2 : 0.16, 0.6);
  return kind === 'touch' ? stickShape(x, 0.15, 0.3) : stickShape(x);
}

// Easy's numbers (ESTIMATE, set on scripts/drive-feel.mjs levels: the naive driver on the four roads).
export const EASY = {
  steerV0: 15, steerV1: 60, steerMin: 0.6,   // steer gain 1 / (1 + (v − v0)/v1) past v0 m/s, never under steerMin
  pedalIn: 0.6,                               // s to full throttle (Standard 0.3)
  ellipse: 0.7,                               // throttle ≤ 1 − ellipse·|steer| at speed: the tyres keep their side force
  slip0: 0.06, slipK: 2.2, slipCut: 8,        // rear slip past slip0 rad: counter-steer slipK per rad, throttle cut
  aLat: 5.5, aBrake: 5.0, react: 0.35,        // governor: the bend's speed √(aLat·R), braking at aBrake after react s
  edge: 0.9, near: 0.5, kEdge: 0.22, kDrift: 0.05, nudge: 0.4,   // lane keep: from hw − edge − near metres
  kDamp: 0.03, damp: 0.15,                    // lane keep: steer against drifting across the road (per m/s), up to damp
  vRoad: 120 / 3.6,                           // a newcomer's top speed on a road (m/s)
};

// AI drive's numbers (ESTIMATE, set on scripts/drive-feel.mjs diag: every naive driver on every road, 0 exits
// and 0 spins, at a pace near a careful driver's on Standard).
export const AI = {
  aLat: 6.2, aBrake: 5.5, react: 0.2,         // the safe speed: each bend at √(aLat·R), braking at aBrake after react s
  vCap: 140 / 3.6,                            // m/s: the fastest it drives anywhere
  lane: 1.9, laneK: 0.48, edge: 1.3,          // the lane centre (m, or that share of the half-width); the centre's margin to the edge
  edgeV0: 12, edgeK: 0.025, edgeMax: 0.7,     // …plus edgeK m per m/s past edgeV0, up to edgeMax (a target near the edge at speed overshoots)
  shift: 2.6, settle: 0.8,                    // m/s across the road while steer is held; back to the nearest lane once let go
  ld0: 4.5, ldV: 0.38, gain: 1.1,             // pure pursuit: look-ahead (m, + per m/s) and gain (src/drive/pilot.js)
  hard: 0.5, hardT: 0.8, hardRamp: 0.8, hardMax: 0.7,      // a steer `hard` past the road's, held hardT s one way, takes the wheel over hardRamp s, up to hardMax
  guard: 0.7,                                 // edge guard: the lateral position predicted guard s ahead
  slip0: 0.05, slipK: 2.4, slipCut: 9,        // slide catch (Easy's, a little earlier)
  ellipse: 0.7,                               // throttle inside the friction ellipse while steering at speed
  far: 8,                                     // m/s: the most it drives while off the road, finding it again
};
const DT_ = 1 / 240, WB = SPEC.wheelbase;
// An arctangent small enough to inline (a double returned from a call that isn't inlined is a new heap
// number, 0049): x / (1 + 0.28·x²), and its complement past 1; within 0.005 rad of the true angle, which
// is plenty for a wheel, and only + − × ÷, so the same on every engine (invariant 4's reason for dmath).
const atanA = (x) => (x > 1 ? 1.5707963267948966 - x / (x * x + 0.28) : x < -1 ? -1.5707963267948966 - x / (x * x + 0.28) : x / (1 + 0.28 * x * x));
const ADV_KEY_T = 0.08;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// The road nearest the car: a local search from the last hint (the road is a polyline of samples).
// A car put somewhere else (a reset, another road, the endless road trimmed behind) is found again by a
// search of the whole road.
function nearest(road, x, z, hint) {
  let a = 0, b = road.n - 1;
  const local = hint >= 0 && hint < road.n;
  if (local) { a = Math.max(0, hint - 40); b = Math.min(road.n - 1, hint + 40); }
  let best = 0, bd = Infinity;
  for (let i = a; i <= b; i++) {
    const ex = road.x[i] - x, ez = road.z[i] - z, d = ex * ex + ez * ez;
    if (d < bd) { bd = d; best = i; }
  }
  return local && bd > 900 ? nearest(road, x, z, -1) : best;
}

// The speed the road allows now: the tightest bend over the braking distance ahead, each bend's own
// speed √(aLat·R) plus what braking at aBrake sheds on the way to it (after a reaction).
const rsOut = { allow: Infinity, v: 0 };
export function roadSpeed(road, hint, dir, v, o = EASY) { rsOut.v = v; return roadSpeedInto(road, hint, dir, o, rsOut).allow; }
// The same at out.v, into out.allow (AI drive's tick: a double passed or returned would be a new heap number, 0049).
function roadSpeedInto(road, hint, dir, o, out) {
  const sp = road.meta.spacing, m = road.m ?? road.n - 1, v = out.v;
  const reach = (v * v) / (2 * o.aBrake) + v * o.react + 25;
  const steps = Math.min(400, Math.ceil(reach / sp));
  let allow = Infinity;
  for (let k = 0; k <= steps; k += 2) {
    const a = hint + dir * k;
    if (a < 1 || a > m - 2) break;
    const b = a + 1;
    const c = Math.abs(road.dx[a - 1] * road.dz[b] - road.dz[a - 1] * road.dx[b]) / (2 * sp);
    if (c < 1e-4) continue;
    const vt = Math.sqrt(o.aLat / c), d = Math.max(0, k * sp - v * o.react);
    const vh = Math.sqrt(vt * vt + 2 * o.aBrake * d);
    if (vh < allow) allow = vh;
  }
  out.allow = allow;
  return out;
}

// The car's numbers the aids read: horizontal speed, forward speed, yaw rate (+ right) and the rear
// axle's slip (+ = the velocity to the car's left of its nose).
const AXLE_R = SPEC.wheelbase - SPEC.comFromFront;   // CoM to the rear axle, m
function carState(car, st) {
  const q = car.quat;
  const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  st.fx = fx; st.fz = fz;
  st.v = Math.sqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z);
  st.vf = car.vel.x * fx + car.vel.z * fz;
  const vl = car.vel.x * fz - car.vel.z * fx;   // + left
  st.yaw = -car.angVel.y;                       // + right
  st.vl = vl;
  // Turning right moves the rear axle left (+), behind the CoM.
  st.beta = st.vf > 3 ? Math.atan2(vl - car.angVel.y * AXLE_R, st.vf) : 0;
  return st;
}

// AI drive's steer for its target across the road, and the road under the car, per tick. `A` is its state
// (one object, no allocation): writes A.want (the steer it wants), A.allow (the safe speed), A.lat, A.hwNow,
// A.dLat, A.E (how far from the centre its target may go), A.laneC (the lanes' centres) and A.bend.
function aiSteer(A, road, car, s) {
  const m = road.m ?? road.n - 1, sp = road.meta.spacing;
  const x = car.pos.x, z = car.pos.z;
  // The road the car is on: a small window around the last sample (a switchback's other leg, a few samples
  // further along the polyline but metres away, is never taken for this one); the whole road only when lost.
  // (src/sim/roads.js nearestSample, inline: a double passed to a call that isn't inlined is a heap number.)
  let i = -1;
  for (let pass = 0; pass < 2 && i < 0; pass++) {
    let a = 0, b = road.n - 1;
    if (pass === 0 && A.hint >= 0) { a = A.hint - 10 > 0 ? A.hint - 10 : 0; b = A.hint + 10 < b ? A.hint + 10 : b; }
    let bd = Infinity;
    for (let k = a; k <= b; k++) { const ex = road.x[k] - x, ez = road.z[k] - z, d = ex * ex + ez * ez; if (d < bd) { bd = d; i = k; } }
    if (pass === 0 && A.hint >= 0 && bd > 900) i = -1;   // lost (a teleport the reset didn't tell us of): the whole road
    if (A.hint < 0) break;
  }
  A.hint = i;
  const j = i < m ? i : m - 1;
  const tx = road.dx[j], tz = road.dz[j];
  // Which way along the road: the car's heading, with hysteresis (a spin or a turn around flips it).
  const along = tx * s.fx + tz * s.fz;
  if (!A.init) A.dir = along >= 0 ? 1 : -1;
  else if (along * A.dir < -0.35) { A.dirT += DT_; if (A.dirT > 0.4) { A.dir = -A.dir; A.dirT = 0; } }
  else A.dirT = 0;
  const dir = A.dir;
  // Across the road, + = left of the way we're going.
  const lx = tz * dir, lz = -tx * dir;
  const ex = x - road.x[i], ez = z - road.z[i];
  const lat = ex * lx + ez * lz;
  // The margin to the edge grows with speed (pulled over at the very edge is for a crawl): at 138 km/h on the
  // Atlantic Road's 6.4 m the car overshot a target 1.3 m in by 0.6 m, into the rail (the multi-seed sweep).
  const vx = s.v - AI.edgeV0, edge = AI.edge + (vx > 0 ? (vx * AI.edgeK < AI.edgeMax ? vx * AI.edgeK : AI.edgeMax) : 0);
  A.edge = edge;
  const hw = road.hw[i], E = hw - edge > 0.3 ? hw - edge : 0.3;
  const laneC = Math.min(AI.lane, hw * AI.laneK);
  A.lat = lat; A.hwNow = hw; A.dLat = car.vel.x * lx + car.vel.z * lz; A.E = E; A.laneC = laneC;
  if (!A.init) { A.tgt = clamp(lat, -E, E); A.init = true; }
  A.tgt = clamp(A.tgt, -E, E);
  // Pure pursuit on a point ld along the road at the target offset (behind the car when reversing).
  const v = s.v, rev = s.vf < -0.5;
  const ld = AI.ld0 + AI.ldV * v;
  const sCar = i * sp + (ex * tx + ez * tz);
  let sA = sCar + (rev ? -dir : dir) * ld;
  const sMax = (m - 1) * sp;
  sA = sA < 0 ? 0 : sA > sMax ? sMax : sA;
  let k = Math.floor(sA / sp);
  if (k > m - 1) k = m - 1;
  const uu = clamp(sA / sp - k, 0, 1);
  const cx = road.x[k] + (road.x[k + 1] - road.x[k]) * uu, cz = road.z[k] + (road.z[k + 1] - road.z[k]) * uu;
  const hwk = road.hw[k], Ek = hwk - edge > 0.3 ? hwk - edge : 0.3;
  let off = clamp(A.tgt, -Ek, Ek);
  // vehicle.js rackLock(v²), inline (its margin is 0.04 rad).
  const vv = v * v, lk = (WB * SPEC.tyreMu * G) / (vv > 1 ? vv : 1) + 0.04, lock = lk < SPEC.steerLock ? lk : SPEC.steerLock;
  // Through a hairpin, use the whole road (as drivers do, and as the test pilot does): the aim drifts to the
  // outside of the bend as it tightens. And the wheel the bend itself asks for (+ right): the player's steer
  // is read against it (tick).
  {
    const a = k - 2 < 0 ? 0 : k - 2, b = k + 2 > m - 1 ? m - 1 : k + 2;
    const cr = road.dx[a] * road.dz[b] - road.dz[a] * road.dx[b];      // < 0: bending left, along the road
    const turn = Math.abs(cr) / (4 * sp);
    const kk = clamp((turn - 1 / 30) / (1 / 9 - 1 / 30), 0, 1);
    if (kk > 0 && !rev) { const want = (cr * dir < 0 ? -1 : 1) * hwk * 0.35; off = clamp(off + (want - off) * kk, -Ek, Ek); }
    A.bend = clamp(((cr * dir < 0 ? -1 : 1) * atanA(WB * turn)) / lock, -1, 1);
  }
  const lkx = road.dz[k] * dir, lkz = -road.dx[k] * dir;
  const px = cx + lkx * off - x, pz = cz + lkz * off - z;
  const right = -(px * s.fz - pz * s.fx), ahead = px * s.fx + pz * s.fz;
  // δ = atan(2·L·sin α / d), with sin α = right / d (α the aim's angle off the nose). Reversing, the steered
  // wheels trail and the path curves the other way (κ = −tan δ / L), and the aim behind flips sin α too:
  // the same expression.
  const d2 = px * px + pz * pz;
  const delta = atanA((2 * WB * right) / (d2 > 1 ? d2 : 1));
  void ahead;
  // The safe speed: the tightest bend over the braking distance ahead (Easy's governor, the AI's grip).
  if (s.vf > 2) { A.v = v; roadSpeedInto(road, i, dir, AI, A); if (A.allow > AI.vCap) A.allow = AI.vCap; } else A.allow = AI.vCap;
  A.want = clamp((delta / lock) * AI.gain, -1, 1);
}

// One tick of AI drive (its own function: the tick's other levels keep their inlining, and nothing here takes
// a double across a call that might not be inlined). Writes o.steer / o.thr / o.brk and the aid.
function aiDrive(A, hands, raw, car, s, road, aid, o) {
  const v = s.v;
  // The player's intent: where the wheel would go (+ right), and GO / BRAKE through the hands' pedals.
  const u = clamp((raw.keyAx || 0) + (raw.stickAx || 0) + (raw.tilt || 0), -1, 1);
  const own = hands.steer(u, v, !raw.keyAx && u !== 0);   // (hands' own state: the wheel the player would hold)
  aiSteer(A, road, car, s);
  const want = A.want;
  // Intent is the wheel past what the bend already asks for: steering with a bend as much as it needs
  // is following the road, more is a move to the inside, against it a move to the outside.
  let e = 0;
  const bend = A.bend;
  if (u > 0.05 || u < -0.05) e = own * bend > 0 ? (own > 0 ? 1 : -1) * Math.max(0, Math.abs(own) - Math.abs(bend)) : own;
  if (e !== 0) A.tgt -= e * AI.shift * DT_;
  else {
    // Let go: settle into the nearest lane, or stay pulled over at the right-hand edge.
    const L = A.laneC, E0 = A.E;
    let a = -L, d = Math.abs(A.tgt + L);
    const dl = Math.abs(A.tgt - L), de = Math.abs(A.tgt + E0);
    if (dl < d) { a = L; d = dl; }
    if (de < d) a = -E0;
    A.tgt += clamp(a - A.tgt, -AI.settle * DT_, AI.settle * DT_);
  }
  A.tgt = clamp(A.tgt, -A.E, A.E);
  // A hard steer held one way takes the wheel, ramped in; anything less is intent only.
  const es = e > AI.hard ? 1 : e < -AI.hard ? -1 : 0;
  if (es !== 0 && es !== A.hardS) { A.hard = 0; A.hardS = es; }
  A.hard = es !== 0 ? A.hard + DT_ : Math.max(0, A.hard - 3 * DT_);
  let w = clamp((A.hard - AI.hardT) / AI.hardRamp, 0, 1) * AI.hardMax;
  // …inside the road's edges: as the car heads for one, the assist takes it back.
  const E = A.hwNow - A.edge > 0.3 ? A.hwNow - A.edge : 0.3;
  const latP = A.lat + A.dLat * AI.guard;
  if (w > 0) w *= 1 - clamp((Math.abs(latP) - E + 0.6) / 0.9, 0, 1);
  let steer = want + (own - want) * w;
  // No lateral-g cap of its own: the rack already stops at the tyres' peak (vehicle.js rackLock), and a
  // kinematic cap (δ = atan(L·a/v²)) ignores the car's understeer, so it held the wheel short of what a
  // bend at the safe speed needs and ran the car wide (drive-feel diag, 0109).
  // A slide: steer where the car is going, and lift.
  const beta = s.vf > 3 ? atanA((s.vl - car.angVel.y * AXLE_R) / s.vf) : 0;
  const bx = beta > AI.slip0 ? beta - AI.slip0 : beta < -AI.slip0 ? beta + AI.slip0 : 0;
  const p = hands.pedals(!!raw.up, !!raw.down);
  let brk = Math.max(p.brk, raw.brkA || 0);
  let thr = brk > 0.05 ? 0 : Math.max(p.thr, raw.thrA || 0);
  if (bx !== 0 && v > 5) { steer -= AI.slipK * bx; thr *= clamp(1 - AI.slipCut * Math.abs(bx), 0, 1); aid.catch = Math.abs(bx); }
  thr = Math.min(thr, 1 - AI.ellipse * Math.abs(steer) * clamp((v - 5) / 15, 0, 1));
  // The pace: GO up to the safe speed for the bend ahead, never past it (braking for it, GO or not).
  const allow = Math.abs(A.lat) > A.hwNow + 0.5 ? Math.min(A.allow, AI.far) : A.allow;
  if (v > allow - 2) thr = Math.min(thr, clamp((allow - v) * 0.5, 0, 1));
  if (s.vf > 1 && v > allow + 0.3) { const g = clamp((v - allow) * 0.35 + 0.1, 0, 1); if (g > brk) { brk = g; aid.governor = g; } thr = 0; }
  steer = clamp(steer, -1, 1);
  aid.ai = 1; aid.allow = allow; aid.tgt = A.tgt; aid.lat = A.lat; aid.take = w;
  o.steer = steer; o.thr = thr; o.brk = brk;
}

// One driver per input surface. `tick(raw, car, ctx, out)` once per 240 Hz sim tick:
//   raw: { keyAx (−1, 0, 1), stickAx (already shaped by shapeStick), tilt, up, down (digital pedals),
//          thrA, brkA (analog pedals 0–1), hb (handbrake 0–1) }
//   ctx: { free (an unscored mode: the level may set ESC/TC/ABS), road (Free Drive's road, for Easy and AI drive) }
// opts: { tc, abs, ai (AI drive on: it drives wherever ctx.road is given) }
// Writes out.steer/throttle/brake, and out.ground = { assist, manual, tcOff, tcSport, absOff, handbrake } for an
// unscored ground (null on a scored one: the flight tier keeps those).
export function createDriver(level = 'standard', opts = {}) {
  const hands = createHands();
  let lvl = validLevel(level) || 'standard';
  let tc = TC_MODES.includes(opts.tc) ? opts.tc : 'on', abs = opts.abs !== false, ai = opts.ai === true;
  // Doubles that change every tick live on an object: a closure variable would box a new heap number
  // on every write (0049).
  const m = { thrE: 0, lastSteer: 0, lastThr: 0, kAx: 0 };
  let hint = -1, lastRoad = null;
  const st = { fx: 0, fz: 1, v: 0, vf: 0, vl: 0, yaw: 0, beta: 0 };
  const ground = { assist: 1, manual: 0, tcOff: false, tcSport: false, absOff: false, handbrake: 0 };
  // What Easy and AI drive did this tick (tests, HUD): ai 1 when AI drive drove it, its target and the
  // car's place across the road (m, + left), and how much of the wheel the player has taken (0–1).
  const aid = { governor: 0, keep: 0, catch: 0, allow: Infinity, ai: 0, tgt: 0, lat: 0, take: 0 };
  // AI drive's state (aiSteer): the road it follows, where on it, which way, its target across it.
  const A = { road: null, hint: -1, init: false, dir: 1, dirT: 0, tgt: 0.5, lat: 0.5, dLat: 0.5, hwNow: 0.5, E: 0.5, laneC: 0.5, allow: Infinity, hard: 0.5, hardS: 0, bend: 0.5, want: 0.5, v: 0.5, edge: 0.5 };
  A.edge = AI.edge; A.tgt = 0; A.lat = 0; A.dLat = 0; A.hwNow = 0; A.E = 0; A.laneC = 0; A.hard = 0; A.bend = 0; A.want = 0; A.v = 0;   // double fields from the start (0049)
  const o3 = { steer: 0.5, thr: 0.5, brk: 0.5 };
  const def = { steer: 0, throttle: 0, brake: 0, ground: null };
  return {
    // The flight's wheel and pedals (src/input.js steers the air with them): the same filter the ground
    // used, so the wheel carries over the lip.
    hands,
    get level() { return lvl; },
    get tc() { return tc; },
    get abs() { return abs; },
    get ai() { return ai; },
    // Where the wheel the player holds is (Advanced: the delivered steer, there are no hands).
    get ax() { return lvl === 'advanced' ? m.lastSteer : hands.ax; },
    get steer() { return m.lastSteer; },
    get throttle() { return m.lastThr; },
    aid,
    set(l, o = {}) {
      const nl = validLevel(l) || lvl;
      if (nl !== lvl) this.reset();
      lvl = nl;
      if (TC_MODES.includes(o.tc)) tc = o.tc;
      if (typeof o.abs === 'boolean') abs = o.abs;
      // Off mid-drive: the wheel the player holds starts where the assist left it, not with a jump.
      if (typeof o.ai === 'boolean' && o.ai !== ai) { ai = o.ai; if (!ai) hands.hold(m.lastSteer); A.init = false; A.hint = -1; A.hard = 0; }
    },
    reset() { hands.reset(); m.thrE = 0; hint = -1; m.lastSteer = 0; m.kAx = 0; A.hint = -1; A.init = false; A.hard = 0; A.road = null; },
    tick(raw, car, ctx = null, out = def) {
      const s = car ? carState(car, st) : st;
      const v = car ? s.v : 0;
      const free = !!ctx?.free;
      let steer, thr, brk;
      aid.governor = 0; aid.keep = 0; aid.catch = 0; aid.allow = Infinity; aid.ai = 0; aid.take = 0;
      const road = ctx?.road;
      if (ai && car && road && road.n > 4) {
        if (road !== A.road) { A.road = road; A.hint = -1; A.init = false; }
        aiDrive(A, hands, raw, car, s, road, aid, o3);
        steer = o3.steer; thr = o3.thr; brk = o3.brk;
      } else if (lvl === 'advanced') {
        // Direct: the stick is the wheel (the rack's own slew is all the filter). A key is on/off, so it
        // gets the quickest hand there is (full lock in ADV_KEY_T, at any speed) and no more.
        const kt = raw.keyAx || 0;
        m.kAx += clamp(kt - m.kAx, -1 / (240 * ADV_KEY_T), 1 / (240 * ADV_KEY_T));
        steer = clamp(m.kAx + (raw.stickAx || 0) + (raw.tilt || 0), -1, 1);
        thr = Math.max(raw.up ? 1 : 0, raw.thrA || 0);
        brk = Math.max(raw.down ? 1 : 0, raw.brkA || 0);
      } else if (lvl === 'easy') {
        const target = clamp((raw.keyAx || 0) + (raw.stickAx || 0) + (raw.tilt || 0), -1, 1);
        const analog = !raw.keyAx && target !== 0;
        const ax = hands.steer(target, v, analog);
        const gain = v > EASY.steerV0 ? Math.max(EASY.steerMin, 1 / (1 + (v - EASY.steerV0) / EASY.steerV1)) : 1;
        steer = ax * gain;
        m.thrE = clamp(m.thrE + (raw.up ? 1 / (240 * EASY.pedalIn) : -2 / (240 * EASY.pedalIn)), 0, 1);
        const p = hands.pedals(false, !!raw.down);
        thr = Math.max(m.thrE, raw.thrA || 0);
        brk = Math.max(p.brk, raw.brkA || 0);
        if (car) {
          // The tyres keep their side force: throttle inside the friction ellipse while steering at speed.
          thr = Math.min(thr, 1 - EASY.ellipse * Math.abs(steer) * clamp((v - 5) / 15, 0, 1));
          // A slide: steer where the car is going, and lift.
          const b = s.beta, bx = b > EASY.slip0 ? b - EASY.slip0 : b < -EASY.slip0 ? b + EASY.slip0 : 0;
          if (bx !== 0 && v > 5) {
            steer -= EASY.slipK * bx;
            thr *= clamp(1 - EASY.slipCut * Math.abs(bx), 0, 1);
            aid.catch = Math.abs(bx);
          }
          const road = ctx?.road;
          if (road && road.n > 4) {
            if (road !== lastRoad) { hint = -1; lastRoad = road; }
            hint = nearest(road, car.pos.x, car.pos.z, hint);
            const j = Math.min(hint, (road.m ?? road.n - 1) - 1);
            const dir = road.dx[j] * s.fx + road.dz[j] * s.fz >= 0 ? 1 : -1;
            // The governor: off the throttle, then braking, when the bend ahead is faster than the tyres.
            if (s.vf > 4) {
              const allow = Math.min(EASY.vRoad, roadSpeed(road, hint, dir, v));
              aid.allow = allow;
              if (v > allow - 1.5) thr = Math.min(thr, clamp((allow - v) / 1.5, 0, 1));
              if (v > allow) { const b2 = clamp((v - allow) * 0.3 + 0.1, 0, 0.9); if (b2 > brk) { brk = b2; aid.governor = b2; } thr = 0; }
            }
            // Lane keeping: a nudge back toward the road when the car nears its edge or drifts out.
            const lx = road.dz[j], lz = -road.dx[j];
            const latC = ((car.pos.x - road.x[hint]) * lx + (car.pos.z - road.z[hint]) * lz) * dir;   // + = the car's left
            const dLat = (car.vel.x * lx + car.vel.z * lz) * dir;
            const zone = road.hw[hint] - EASY.edge - EASY.near;
            const over = Math.abs(latC) - zone;
            if (s.vf > 8) {
              // Weaving across the road: lean against the drift, wherever the car is.
              steer += clamp(EASY.kDamp * dLat, -EASY.damp, EASY.damp);   // drifting to the left (+) → steer right (+)
            }
            if (over > 0 && s.vf > 2) {
              const out_ = Math.sign(latC);                                  // which side
              const drift = dLat * out_ > 0 ? dLat * out_ : 0;               // moving further out
              const n = clamp(EASY.kEdge * over + EASY.kDrift * drift, 0, EASY.nudge);
              steer += out_ * n;                                             // left of centre → steer right (+)
              aid.keep = n;
            }
          }
        }
        steer = clamp(steer, -1, 1);
      } else {
        // Standard: today's hands. The tilt is added after them, as it always was.
        const ka = raw.keyAx || 0, sa = raw.stickAx || 0;
        steer = hands.steer(clamp(ka + sa, -1, 1), v, ka === 0 && sa !== 0) + (raw.tilt || 0);
        const p = hands.pedals(!!raw.up, !!raw.down);
        thr = Math.max(p.thr, raw.thrA || 0);
        brk = Math.max(p.brk, raw.brkA || 0);
      }
      out.steer = steer; out.throttle = thr; out.brake = brk;
      m.lastSteer = steer; m.lastThr = thr;
      if (free) {
        const adv = lvl === 'advanced' && aid.ai === 0;   // AI drive drives a stock car with stability control
        ground.assist = adv ? 0 : 1;
        ground.manual = 0;   // driving is never valve flying: Advanced flight's `manual` is for the air
        ground.tcSport = adv && tc === 'sport';
        ground.tcOff = adv && tc === 'off';
        ground.absOff = adv && !abs;
        ground.handbrake = adv ? clamp(raw.hb || 0, 0, 1) : 0;
        out.ground = ground;
      } else out.ground = null;
      return out;
    },
  };
}

// The car's drivetrain settings for an unscored ground (Free Drive, the Sandbox): ESC, TC and ABS live in
// the sim as flags on the car (never set on a scored run: the Worker's car has them off), so a level's
// choice reaches the tyres without a new logged channel. Mutates `inp` and `car`.
export function applyGround(g, inp, car, flying) {
  if (!car) return;
  if (!g || flying) { car.tcOff = false; car.tcSport = false; car.absOff = false; car.handbrake = 0; return; }
  inp.assist = g.assist; inp.manual = g.manual;
  car.tcOff = g.tcOff; car.tcSport = g.tcSport; car.absOff = g.absOff; car.handbrake = g.handbrake;
}

// --- The setting on this device ---------------------------------------------------------------------
const KEY = 'coldgas_driving';
// AI drive (0109) is on in Free Drive for a player who hasn't chosen (a setting saved before it had no `ai`).
export function loadDriving(coarse, store = typeof localStorage !== 'undefined' ? localStorage : null) {
  const d = { level: defaultLevel(coarse), tc: 'on', abs: true, ai: true, saved: false };
  try {
    const j = JSON.parse(store?.getItem(KEY) || 'null');
    if (j && validLevel(j.level)) { d.level = j.level; d.saved = true; }
    if (j && TC_MODES.includes(j.tc)) d.tc = j.tc;
    if (j && typeof j.abs === 'boolean') d.abs = j.abs;
    if (j && typeof j.ai === 'boolean') d.ai = j.ai;
  } catch { /* storage blocked or junk: the defaults */ }
  return d;
}
export function saveDriving(d, store = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { store?.setItem(KEY, JSON.stringify({ level: d.level, tc: d.tc, abs: d.abs, ai: d.ai !== false })); } catch { /* storage blocked */ }
}
