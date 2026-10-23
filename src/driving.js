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
import { createHands, stickShape } from './hands.js';
import { SPEC } from './sim/spec.js';

export const LEVELS = ['easy', 'standard', 'advanced'];
export const LEVEL_INFO = {
  easy: { name: 'Easy', blurb: 'Brakes for the bend ahead, keeps you on the road, catches slides. A soft stick and a gentle throttle.' },
  standard: { name: 'Standard', blurb: 'Assist driving: speed-sensitive steering, stability and traction control.' },
  advanced: { name: 'Advanced', blurb: 'Direct steering and pedals, analog on triggers and touch. Free Drive: ESC off, TC and ABS your call, H handbrake.' },
};
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
export function roadSpeed(road, hint, dir, v, o = EASY) {
  const sp = road.meta.spacing, m = road.m ?? road.n - 1;
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
  return allow;
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
  // Turning right moves the rear axle left (+), behind the CoM.
  st.beta = st.vf > 3 ? Math.atan2(vl - car.angVel.y * AXLE_R, st.vf) : 0;
  return st;
}

// One driver per input surface. `tick(raw, car, ctx, out)` once per 240 Hz sim tick:
//   raw: { keyAx (−1, 0, 1), stickAx (already shaped by shapeStick), tilt, up, down (digital pedals),
//          thrA, brkA (analog pedals 0–1), hb (handbrake 0–1) }
//   ctx: { free (an unscored mode: the level may set ESC/TC/ABS), road (Free Drive's road, for Easy) }
// Writes out.steer/throttle/brake, and out.ground = { assist, manual, tcOff, tcSport, absOff, handbrake } for an
// unscored ground (null on a scored one: the flight tier keeps those).
export function createDriver(level = 'standard', opts = {}) {
  const hands = createHands();
  let lvl = validLevel(level) || 'standard';
  let tc = TC_MODES.includes(opts.tc) ? opts.tc : 'on', abs = opts.abs !== false;
  let thrE = 0, hint = -1, lastSteer = 0, lastThr = 0, kAx = 0, lastRoad = null;
  const st = { fx: 0, fz: 1, v: 0, vf: 0, yaw: 0, beta: 0 };
  const ground = { assist: 1, manual: 0, tcOff: false, tcSport: false, absOff: false, handbrake: 0 };
  const aid = { governor: 0, keep: 0, catch: 0, allow: Infinity };   // what Easy did this tick (tests, HUD)
  const def = { steer: 0, throttle: 0, brake: 0, ground: null };
  return {
    // The flight's wheel and pedals (src/input.js steers the air with them): the same filter the ground
    // used, so the wheel carries over the lip.
    hands,
    get level() { return lvl; },
    get tc() { return tc; },
    get abs() { return abs; },
    // Where the wheel the player holds is (Advanced: the delivered steer, there are no hands).
    get ax() { return lvl === 'advanced' ? lastSteer : hands.ax; },
    get steer() { return lastSteer; },
    get throttle() { return lastThr; },
    aid,
    set(l, o = {}) {
      const nl = validLevel(l) || lvl;
      if (nl !== lvl) this.reset();
      lvl = nl;
      if (TC_MODES.includes(o.tc)) tc = o.tc;
      if (typeof o.abs === 'boolean') abs = o.abs;
    },
    reset() { hands.reset(); thrE = 0; hint = -1; lastSteer = 0; kAx = 0; },
    tick(raw, car, ctx = null, out = def) {
      const s = car ? carState(car, st) : st;
      const v = car ? s.v : 0;
      const free = !!ctx?.free;
      let steer, thr, brk;
      aid.governor = 0; aid.keep = 0; aid.catch = 0; aid.allow = Infinity;
      if (lvl === 'advanced') {
        // Direct: the stick is the wheel (the rack's own slew is all the filter). A key is on/off, so it
        // gets the quickest hand there is (full lock in ADV_KEY_T, at any speed) and no more.
        const kt = raw.keyAx || 0;
        kAx += clamp(kt - kAx, -1 / (240 * ADV_KEY_T), 1 / (240 * ADV_KEY_T));
        steer = clamp(kAx + (raw.stickAx || 0) + (raw.tilt || 0), -1, 1);
        thr = Math.max(raw.up ? 1 : 0, raw.thrA || 0);
        brk = Math.max(raw.down ? 1 : 0, raw.brkA || 0);
      } else if (lvl === 'easy') {
        const target = clamp((raw.keyAx || 0) + (raw.stickAx || 0) + (raw.tilt || 0), -1, 1);
        const analog = !raw.keyAx && target !== 0;
        const ax = hands.steer(target, v, analog);
        const gain = v > EASY.steerV0 ? Math.max(EASY.steerMin, 1 / (1 + (v - EASY.steerV0) / EASY.steerV1)) : 1;
        steer = ax * gain;
        thrE = clamp(thrE + (raw.up ? 1 / (240 * EASY.pedalIn) : -2 / (240 * EASY.pedalIn)), 0, 1);
        const p = hands.pedals(false, !!raw.down);
        thr = Math.max(thrE, raw.thrA || 0);
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
      lastSteer = steer; lastThr = thr;
      if (free) {
        const adv = lvl === 'advanced';
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
export function loadDriving(coarse, store = typeof localStorage !== 'undefined' ? localStorage : null) {
  const d = { level: defaultLevel(coarse), tc: 'on', abs: true, saved: false };
  try {
    const j = JSON.parse(store?.getItem(KEY) || 'null');
    if (j && validLevel(j.level)) { d.level = j.level; d.saved = true; }
    if (j && TC_MODES.includes(j.tc)) d.tc = j.tc;
    if (j && typeof j.abs === 'boolean') d.abs = j.abs;
  } catch { /* storage blocked or junk: the defaults */ }
  return d;
}
export function saveDriving(d, store = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { store?.setItem(KEY, JSON.stringify({ level: d.level, tc: d.tc, abs: d.abs })); } catch { /* storage blocked */ }
}
