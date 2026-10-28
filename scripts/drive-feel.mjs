// Driving feel bench: the manoeuvres a test driver runs, through the same keyboard hands a player
// has (src/hands.js), on open concrete. node scripts/drive-feel.mjs [bench|road|levels] [assist|pro]
// `levels` (0066): the driving levels (src/driving.js) on the four roads, a naive driver on the keys and
// on the touch stick (Easy vs today's Standard) and a skilled one on a gamepad (Advanced vs Standard).
import { createVehicle, step, newInput, DT } from '../src/sim/vehicle.js';
import { initPhysics } from '../src/sim/engine.js';
import { createHands } from '../src/hands.js';
import { createDriver, shapeStick, applyGround } from '../src/driving.js';

const KM = 3.6;
export const spd = (s) => Math.hypot(s.vel.x, s.vel.z);
// Heading and body-frame velocities: forward, and lateral (+ = the car's left).
export function bodyV(s) {
  const q = s.quat;
  const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return { vf: s.vel.x * fx + s.vel.z * fz, vl: s.vel.x * fz - s.vel.z * fx, heading: Math.atan2(fx, fz) };
}
export function fresh(x = 200) {
  const s = createVehicle('lineup'); s.pos.x = x; s.pos.z = -600;
  const inp = newInput();
  for (let i = 0; i < 240; i++) step(s, inp);
  return s;
}
// Keyboard hands; `cruise` holds a speed with a proportional throttle (a driver's right foot).
export function kbHands(tier = 'assist', level = null) {
  const k = createHands(), drv = level ? createDriver(level) : null;
  const raw = { keyAx: 0, stickAx: 0, tilt: 0, up: 0, down: 0, thrA: 0, brkA: 0, hb: 0 }, ctx = { free: true };
  return {
    reset: () => { k.reset(); drv?.reset(); },
    tick(s, keys) {
      let inp;
      if (drv) {
        raw.keyAx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); raw.up = !!keys.up; raw.down = !!keys.down;
        const d = drv.tick(raw, s, ctx);
        inp = newInput(); inp.assist = tier === 'assist' ? 1 : 0;
        inp.steer = d.steer; inp.throttle = d.throttle; inp.brake = d.brake;
        applyGround(d.ground, inp, s, false);
      } else inp = k.keyboard(keys, s, tier);
      if (keys.cruise != null) { const e = keys.cruise - spd(s); inp.throttle = Math.max(0, Math.min(1, e * 0.5 + 0.12)); inp.brake = 0; }
      return inp;
    },
  };
}
export function toSpeed(s, v, h) {
  h.reset();
  while (spd(s) < v) step(s, h.tick(s, { up: 1 }));
  for (let i = 0; i < 240; i++) step(s, h.tick(s, { cruise: v }));
}
const yawR = (s) => -s.angVel.y;   // + = turning right
const latG = (s) => (spd(s) * Math.abs(s.angVel.y)) / 9.81;

export function bench(tier = 'assist', log = console.log, level = null) {
  const out = {};
  const report = (name, o) => { out[name] = o; log(name.padEnd(30), Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(Math.abs(v) < 10 ? 3 : 1)}`).join('  ')); };
  const h = kbHands(tier, level);
  // 1. Step steer at 100 km/h: hold right 2.5 s, then let go.
  {
    const s = fresh(); toSpeed(s, 100 / KM, h);
    let peak = 0, peakT = 0, lat = 0, beta = 0, t90 = -1; const tr = [];
    for (let i = 0; i < 240 * 2.5; i++) {
      step(s, h.tick(s, { right: 1, cruise: 100 / KM }));
      const r = yawR(s); if (r > peak) { peak = r; peakT = i * DT; }
      lat = Math.max(lat, latG(s));
      const b = bodyV(s); beta = Math.max(beta, Math.abs(Math.atan2(b.vl, b.vf)));
      tr.push(r);
    }
    const ss = tr.slice(-120).reduce((a, b) => a + b, 0) / 120;
    t90 = tr.findIndex((r) => r > 0.9 * ss) * DT;
    report('step steer 100 (hold R)', { peakYaw: peak, tPeak: peakT, t90, ssYaw: ss, overshootPct: (peak / ss - 1) * 100, latG: lat, betaDeg: beta * 57.3, kmh: spd(s) * KM });
    let t0 = -1, counter = 0;
    for (let i = 0; i < 240 * 3; i++) { step(s, h.tick(s, { cruise: 100 / KM })); const r = yawR(s); counter = Math.min(counter, r); if (t0 < 0 && Math.abs(r) < 0.02) t0 = i * DT; }
    report('  let go → straight', { tYaw0: t0, counterYaw: counter, yawEnd: yawR(s) });
  }
  // 1b. A stick flicked to full lock at 100 km/h (the rack's own rate, no hands): yaw overshoot.
  {
    const s = fresh(); toSpeed(s, 100 / KM, h);
    let peak = 0, beta = 0; const tr = [];
    for (let i = 0; i < 240 * 3; i++) {
      const inp = h.tick(s, { cruise: 100 / KM }); inp.steer = 1;
      step(s, inp);
      peak = Math.max(peak, yawR(s)); tr.push(yawR(s));
      const b = bodyV(s); beta = Math.max(beta, Math.abs(Math.atan2(b.vl, b.vf)));
    }
    const ss = tr.slice(-120).reduce((a, b) => a + b, 0) / 120;
    report('flick full lock 100 (stick)', { peakYaw: peak, ssYaw: ss, overshootPct: (peak / ss - 1) * 100, betaDeg: beta * 57.3 });
  }
  // 2. Taps at 100 km/h: heading change and sideways offset after 3 s.
  for (const tap of [0.1, 0.25, 0.5]) {
    const s = fresh(); toSpeed(s, 100 / KM, h);
    const b0 = bodyV(s), x0 = s.pos.x;
    let peak = 0;
    for (let i = 0; i < 240 * 3; i++) { step(s, h.tick(s, { right: i < tap * 240, cruise: 100 / KM })); peak = Math.max(peak, Math.abs(yawR(s))); }
    report(`tap R ${tap} s @100`, { dHeadingDeg: (bodyV(s).heading - b0.heading) * 57.3, dRight: -(s.pos.x - x0), peakYaw: peak });
  }
  // 3. Lane change at 100 km/h: R 0.4 s, L 0.4 s, settle 3 s.
  {
    const s = fresh(); toSpeed(s, 100 / KM, h);
    const b0 = bodyV(s), x0 = s.pos.x;
    let peak = 0, lat = 0;
    for (let i = 0; i < 240 * 4; i++) {
      const t = i * DT;
      step(s, h.tick(s, { right: t < 0.4, left: t > 0.55 && t < 0.95, cruise: 100 / KM }));
      peak = Math.max(peak, Math.abs(yawR(s))); lat = Math.max(lat, latG(s));
    }
    report('lane change @100', { dRight: -(s.pos.x - x0), dHeadingDeg: (bodyV(s).heading - b0.heading) * 57.3, yawEnd: yawR(s), peakYaw: peak, latG: lat });
  }
  // 4. On-centre at 130 km/h: a yaw kick of 0.05 rad/s, hands off.
  {
    const s = fresh(); toSpeed(s, 130 / KM, h);
    const b0 = bodyV(s);
    s.angVel.y += 0.05; s.angMom.y += 0.05 * 3080;
    let zc = 0, last = 0, t2 = -1;
    for (let i = 0; i < 240 * 5; i++) { step(s, h.tick(s, { cruise: 130 / KM })); const r = yawR(s); if (i && Math.sign(r) !== Math.sign(last)) zc++; last = r; if (t2 < 0 && Math.abs(r) < 0.005) t2 = i * DT; }
    report('on-centre 130 (yaw kick)', { dHeadingDeg: (bodyV(s).heading - b0.heading) * 57.3, tSettle: t2, signFlips: zc, yawEnd: yawR(s) });
  }
  // 5. 60 mph–0 on the key.
  {
    const s = fresh(); toSpeed(s, 26.82, h);
    const z0 = s.pos.z, x0 = s.pos.x; let t = 0;
    h.reset();
    while (spd(s) > 0.3 && t < 10) { step(s, h.tick(s, { down: 1 })); t += DT; }
    report('60 mph–0 (S)', { m: s.pos.z - z0, s: t, drift: s.pos.x - x0 });
  }
  // 6. Brake into a corner at 100 km/h: S and R together 1.5 s.
  {
    const s = fresh(); toSpeed(s, 100 / KM, h);
    let beta = 0, peak = 0;
    for (let i = 0; i < 240 * 1.5; i++) { step(s, h.tick(s, { down: 1, right: 1 })); const b = bodyV(s); beta = Math.max(beta, Math.abs(Math.atan2(b.vl, Math.abs(b.vf)))); peak = Math.max(peak, Math.abs(yawR(s))); }
    report('trail-brake 100 (S+R)', { betaDeg: beta * 57.3, peakYaw: peak, kmhEnd: spd(s) * KM });
  }
  // 7. Hairpin at 25 km/h: full lock.
  {
    const s = fresh(); toSpeed(s, 25 / KM, h);
    for (let i = 0; i < 240 * 3; i++) step(s, h.tick(s, { right: 1, cruise: 25 / KM }));
    report('full lock 25 km/h', { radiusM: spd(s) / Math.abs(s.angVel.y), steerRad: Math.abs(s.steer), latG: latG(s) });
  }
  // 8. Lift off mid-corner at 80 km/h.
  {
    const s = fresh(); toSpeed(s, 80 / KM, h);
    for (let i = 0; i < 240 * 2; i++) step(s, h.tick(s, { right: 1, cruise: 80 / KM }));
    let beta = 0;
    for (let i = 0; i < 240 * 1.5; i++) { step(s, h.tick(s, { right: 1 })); const b = bodyV(s); beta = Math.max(beta, Math.abs(Math.atan2(b.vl, b.vf))); }
    report('lift-off mid-corner 80', { betaDeg: beta * 57.3, yaw: yawR(s) });
  }
  // 9. Full throttle and lock from 40 km/h.
  {
    const s = fresh(); toSpeed(s, 40 / KM, h);
    let beta = 0;
    for (let i = 0; i < 240 * 2; i++) { step(s, h.tick(s, { right: 1, up: 1 })); const b = bodyV(s); beta = Math.max(beta, Math.abs(Math.atan2(b.vl, Math.max(0.1, b.vf)))); }
    report('throttle + lock from 40', { betaDeg: beta * 57.3, kmh: spd(s) * KM });
  }
  // 10. Steady cornering limit at 25 m/s (full key held 4 s).
  {
    const s = fresh(); toSpeed(s, 25, h);
    let lat = 0;
    for (let i = 0; i < 240 * 4; i++) { step(s, h.tick(s, { right: 1, cruise: 25 })); if (i > 480) lat = Math.max(lat, latG(s)); }
    report('steady full lock 90 km/h', { latG: lat, kmh: spd(s) * KM });
  }
  return out;
}

// A person on a keyboard driving a real road: they look ahead (pure pursuit), react 0.18 s late,
// and press and release the arrow keys (never a fraction of a key); they pick a speed for the
// bend ahead and lift or brake for it, a little too fast (`push` × the grip they think they have).
// Reports how far they got in `secs`, rail and verge contacts, and the worst slide.
export async function loadRoad(id) {
  if (id === 'endless' || id.startsWith('endless:')) {
    // The endless road from a seed (default 'cold-gas'): its course rides along (objects, the ground).
    const { createEndlessCourse } = await import('../src/sim/endless.js');
    const course = createEndlessCourse(id.slice(8) || 'cold-gas');
    course.road.course = course;
    return course.road;
  }
  const { readFileSync } = await import('node:fs');
  const { gunzipSync } = await import('node:zlib');
  const { parseRoad, buildRoad } = await import('../src/sim/roads.js');
  const raw = gunzipSync(readFileSync(new URL(`../public/roads/${id}.bin.gz`, import.meta.url)));
  return buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
}
// Naive input (0108): a person who doesn't read the road at all. Whole key presses (or a thumb thrown
// anywhere on the stick), from a seeded generator, so a run is the same run every time.
//   mash    a new random mix of ← / → / nothing, GO (70 %) and BRAKE (10 %) every 0.15–1.2 s
//   hold    GO and → held the whole way          hold-l   GO and ←
//   zigzag  GO, and ← / → swapped every 1.2 s     swerve   GO, a full-lock jab of 0.3–0.8 s every ≈ 2 s
//   go      GO held, hands off the wheel
export const NAIVE = ['mash', 'hold', 'hold-l', 'zigzag', 'swerve', 'go'];
function naiveInput(kind, n, st, rnd) {
  const t = n * DT;
  if (kind === 'go') { st.ax = 0; st.up = 1; st.down = 0; return st; }
  if (kind === 'hold' || kind === 'hold-l') { st.ax = kind === 'hold' ? 1 : -1; st.up = 1; st.down = 0; return st; }
  if (kind === 'zigzag') { st.ax = Math.floor(t / 1.2) % 2 ? 1 : -1; st.up = 1; st.down = 0; return st; }
  if (t < st.next) return st;
  if (kind === 'swerve') {
    st.up = 1; st.down = 0;
    if (st.ax !== 0) { st.ax = 0; st.next = t + 1 + rnd() * 2; } else { st.ax = rnd() < 0.5 ? -1 : 1; st.next = t + 0.3 + rnd() * 0.5; }
    return st;
  }
  st.ax = [-1, 0, 1][Math.floor(rnd() * 3)]; st.up = rnd() < 0.7 ? 1 : 0; st.down = rnd() < 0.1 ? 1 : 0;
  if (st.analog) st.ax = st.ax * (0.3 + 0.7 * rnd());   // a thumb lands anywhere on the stick
  st.next = t + 0.15 + rnd() * 1.05;
  return st;
}

// `level` drives through src/driving.js (null: the old keyboard hands straight into the sim); `device`
// 'keys' | 'touch' (a thumb chasing the wheel on the stick) | 'pad' (a skilled analog stick and triggers)
// | 'tilt' (the phone tilted to chase the wheel: a hand's rate and tremor, read in 5 % steps like
// src/touch-settings.js). `naive` (one of NAIVE) replaces the eye on the road with naive input on that device.
// `ai` (0108): Free Drive's AI assist on. Spins and excursions count each time the car starts sliding past
// 50° or leaves the tarmac; `firstLoss` is the time of the first of either (s, Infinity: never).
export async function roadDrive(road, { tier = 'assist', secs = 90, push = 1.0, react = 0.18, start = 18, pilot = null, vmax = 45, analog = false, level = null, device = 'keys', tc = 'on', abs = true, naive = null, seed = 1, ai = false } = {}) {
  const { createRoadCourse, poseAt, nearestSample } = await import('../src/sim/roads.js');
  const drive = pilot ? (await import('../src/drive/pilot.js')).createPilot(road, pilot) : null;
  const { quatFromYaw } = await import('../src/sim/m3.js');
  const { SPEC } = await import('../src/sim/spec.js');
  const course = road.course || createRoadCourse(road, { name: 'bench' });
  if (road.endless) start = Math.max(start, 60);
  let rs = (seed * 2654435761) % 2147483647 || 7;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const nv = { ax: 0, up: 0, down: 0, next: 0, analog: device !== 'keys' };
  let firstLoss = Infinity, tiltX = 0;
  const c = createVehicle(course);
  const p0 = poseAt(road, start, 1);
  c.pos.x = p0.x; c.pos.y = p0.y + SPEC.comHeight + 0.04; c.pos.z = p0.z; quatFromYaw(c.quat, p0.yaw);
  const k = createHands();
  const sp = road.meta.spacing;
  const eye = (await import('../src/drive/pilot.js')).createPilot(road, { vmax, lat: push });
  const drv = level ? createDriver(level, { tc, abs, ai }) : null, raw = { keyAx: 0, stickAx: 0, tilt: 0, up: 0, down: 0, thrA: 0, brkA: 0, hb: 0 };
  const ctx = { free: true, road };
  let thumbX = 0, padX = 0, pvx = 0, pvz = 0, spins = 0, spinWas = false, excursions = 0, offWas = false, latG = 0, latF = 0;
  let hint = p0.i, maxBeta = 0, offRoad = 0, rail = 0, railWas = false, resets = 0, maxOff = 0, se = 0, ns = 0;
  const delay = Math.round(react * 240), seen = [];
  let keys = { left: 0, right: 0, up: 0, down: 0 }, stuck = 0;
  const N = secs * 240;
  let n = 0;
  for (; n < N; n++) {
    if (road.endless) road.ensure(c.pos.z + 800);
    hint = nearestSample(road, c.pos.x, c.pos.z, hint, 40);
    const q = c.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const v = Math.hypot(c.vel.x, c.vel.z);
    // What they see now (where the road goes, how fast they'd take the bend: the road pilot's eye),
    // acted on `react` later with whole keys, against how far the wheel has already gone.
    const want = eye(c);
    seen.push({ steer: want.steer, thr: want.throttle, brk: want.brake });
    const o = seen.length > delay ? seen.shift() : seen[0];
    const err = o.steer - (drv ? drv.ax : k.ax);
    const band = 0.03 + 0.05 * Math.abs(o.steer);
    keys.right = err > band ? 1 : err < -band ? 0 : keys.right && err > 0 ? 1 : 0;
    keys.left = err < -band ? 1 : err > band ? 0 : keys.left && err < 0 ? 1 : 0;
    keys.up = o.thr > 0.35 ? 1 : 0;
    keys.down = o.brk > 0.15 ? 1 : 0;
    if (naive) {
      naiveInput(naive, n, nv, rnd);
      keys.right = nv.ax > 0 ? 1 : 0; keys.left = nv.ax < 0 ? 1 : 0; keys.up = nv.up; keys.down = nv.down;
    }
    let inp;
    if (drive) inp = drive(c);
    else if (drv) {
      raw.keyAx = 0; raw.stickAx = 0; raw.up = keys.up; raw.down = keys.down; raw.thrA = 0; raw.brkA = 0;
      if (device === 'keys') raw.keyAx = keys.right - keys.left;
      else if (naive) {
        // A thumb (or a tilted phone) put where the naive input says, at once.
        if (device === 'tilt') raw.tilt = Math.round(nv.ax * 20) / 20;
        else raw.stickAx = shapeStick(level, nv.ax, device === 'pad' ? 'pad' : 'touch');
      } else if (device === 'tilt') {
        // A phone tilted to chase the wheel it sees: ≈ 3 steer units a second (60°/s of roll over the 17° of
        // travel), a hand's tremor (±1° at 8 Hz, ±0.06 of steer), read in 5 % steps (src/touch-settings.js).
        tiltX += Math.max(-3 * DT, Math.min(3 * DT, o.steer - tiltX));
        raw.tilt = Math.round(Math.max(-1, Math.min(1, tiltX + 0.06 * Math.sin(n * DT * 2 * Math.PI * 8))) * 20) / 20;
      } else if (device === 'touch') {
        // A thumb on a 2 cm stick: it chases the wheel it sees, at a thumb's speed, past the dead zone.
        thumbX = Math.max(-1, Math.min(1, thumbX + Math.max(-0.03, Math.min(0.03, (o.steer - drv.ax) * 0.6))));
        raw.stickAx = shapeStick(level, thumbX, 'touch');
      } else {
        // A skilled thumb: smooth (≈80 ms), on the wanted steer, and it catches a slide the way a driver
        // does (opposite lock with the tail's slip, and a lift), as stability control would.
        const bb = bodyV(c), slip = bb.vf > 5 ? Math.atan2(bb.vl - c.angVel.y * 1.5, bb.vf) : 0;
        const sx = slip > 0.05 ? slip - 0.05 : slip < -0.05 ? slip + 0.05 : 0;
        padX += (Math.max(-1, Math.min(1, o.steer - 2.5 * sx)) - padX) * (DT / 0.08);
        raw.stickAx = invShape(level, padX);
        raw.up = 0; raw.down = 0; raw.thrA = o.thr * Math.max(0, 1 - 6 * Math.abs(sx)); raw.brkA = o.brk;
      }
      const d = drv.tick(raw, c, ctx);
      inp = newInput(); inp.assist = tier === 'assist' ? 1 : 0;
      inp.steer = d.steer; inp.throttle = d.throttle; inp.brake = d.brake;
      applyGround(d.ground, inp, c, false);
    } else inp = k.keyboard(keys, c, tier);
    if (analog && !drv) inp.steer = Math.max(-1, Math.min(1, o.steer));
    // Reverse is the drive's own rule (src/drive/index.js); a stuck driver backs off and resets.
    globalThis.__trace?.(c, inp, n, drv, hint);
    step(c, inp);
    const b = bodyV(c);
    if (v > 5) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(b.vl, Math.abs(b.vf))) * 57.3);
    const hm = Math.min(hint, road.m - 1);
    const off = Math.abs((c.pos.x - road.x[hint]) * road.dz[hm] - (c.pos.z - road.z[hint]) * road.dx[hm]);
    const lat = (c.pos.x - road.x[hint]) * road.dz[hm] - (c.pos.z - road.z[hint]) * road.dx[hm];   // + left
    if (v > 5) { const e = lat + Math.min(1.6, road.hw[hint] * 0.4); se += e * e; ns++; }
    maxOff = Math.max(maxOff, off);
    if (off > road.hw[hint] + 0.2) offRoad++;
    const isOff = off > road.hw[hint] + 0.2;
    if (isOff && !offWas) { excursions++; firstLoss = Math.min(firstLoss, n * DT); }
    offWas = isOff;
    const spinning = v > 4 && Math.abs(Math.atan2(b.vl, Math.abs(b.vf))) > 0.87;
    if (spinning && !spinWas) { spins++; firstLoss = Math.min(firstLoss, n * DT); }
    spinWas = spinning;
    // Cornering g: the body's sideways acceleration (from the velocity change), held 0.25 s, wheels down.
    {
      const qq = c.quat, lfx = 1 - 2 * (qq.y * qq.y + qq.z * qq.z), lfz = 2 * (qq.x * qq.z - qq.w * qq.y);
      const aL = ((c.vel.x - pvx) * lfx + (c.vel.z - pvz) * lfz) / DT;
      pvx = c.vel.x; pvz = c.vel.z;
      if (c.grounded === 4 && v > 8) { latF += (Math.abs(aL) / 9.81 - latF) * (DT / 0.25); latG = Math.max(latG, latF); } else latF = 0;
    }
    const hitRail = c.hullContact && off > road.hw[hint] - 1.3;
    if (hitRail && !railWas) rail++;
    railWas = hitRail;
    stuck = v < 1 ? stuck + 1 : 0;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (stuck > 240 * 2 || off > 30 || upY < 0.2) {
      resets++;
      if (upY < 0.2 && !spinWas) { spins++; firstLoss = Math.min(firstLoss, n * DT); }
      drv?.reset(); thumbX = 0;
      const pr = poseAt(road, Math.min(road.length - 6, hint * sp + 3), 1);
      c.pos.x = pr.x; c.pos.y = pr.y + SPEC.comHeight + 0.04; c.pos.z = pr.z; quatFromYaw(c.quat, pr.yaw);
      c.vel.x = c.vel.y = c.vel.z = 0; c.angVel.x = c.angVel.y = c.angVel.z = 0; c.angMom.x = c.angMom.y = c.angMom.z = 0;
      c.engineHeld = false; stuck = 0; seen.length = 0;
    }
    if (hint >= road.n - 10) break;
  }
  const km = Math.max(1e-3, ((hint - (start / sp)) * sp) / 1000);
  return { km: (hint * sp) / 1000, kmh: (hint * sp) / secs * 3.6, avgKmh: (km * 1000) / Math.max(1, n * DT) * 3.6, exitsKm: excursions / km, railsKm: rail / km, firstLoss, offRoadPct: (offRoad / N) * 100, rails: rail, resets, maxBetaDeg: maxBeta, maxOff, laneRms: Math.sqrt(se / Math.max(1, ns)), spins, excursions, latG };
}
// The stick position a skilled thumb holds for a wanted steer, through the level's shaping (bisection).
function invShape(level, want) {
  if (want === 0) return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (shapeStick(level, m, 'pad') < Math.abs(want)) lo = m; else hi = m; }
  return Math.sign(want) * shapeStick(level, hi, 'pad');
}

// The levels on the four roads: totals of spins + excursions per driver and level (0066's gates).
export async function levels(log = console.log, { secs = 60 } = {}) {
  const roads = ['stelvio', 'transfagarasan', 'bigsur', 'atlantic'];
  const drivers = [
    { name: 'naive keys', device: 'keys', push: 1.25, react: 0.25, levels: ['standard', 'easy'] },
    { name: 'naive touch', device: 'touch', push: 1.25, react: 0.25, levels: ['standard', 'easy'] },
    // A skilled driver on a gamepad, at the limit of the technical passes (1.3 g bends, 50 ms reaction, catching
    // slides by hand); and at speed on the coast roads, where without ESC a slip is a spin.
    { name: 'skilled passes', device: 'pad', push: 1.3, react: 0.05, vmax: 60, levels: ['standard', 'advanced'], roads: ['stelvio', 'transfagarasan'] },
    { name: 'skilled coast', device: 'pad', push: 1.15, react: 0.05, vmax: 60, levels: ['standard', 'advanced'], roads: ['bigsur', 'atlantic'] },
  ];
  const out = {};
  for (const id of roads) {
    const road = await loadRoad(id);
    for (const d of drivers) for (const level of d.levels) {
      if (d.roads && !d.roads.includes(id)) continue;
      const r = await roadDrive(road, { level, device: d.device, push: d.push, react: d.react, vmax: d.vmax ?? 45, secs });
      const key = `${d.name}|${level}`;
      const t = (out[key] ||= { spins: 0, excursions: 0, resets: 0, km: 0, latG: 0, offRoadPct: 0, n: 0 });
      t.spins += r.spins; t.excursions += r.excursions; t.resets += r.resets; t.km += r.km; t.latG = Math.max(t.latG, r.latG); t.offRoadPct += r.offRoadPct; t.n++;
      log(`${id.padEnd(15)} ${d.name.padEnd(12)} ${level.padEnd(9)}`, ['km', 'kmh', 'spins', 'excursions', 'resets', 'offRoadPct', 'maxBetaDeg', 'latG'].map((k) => `${k} ${r[k].toFixed(2)}`).join('  '));
    }
  }
  log('--- totals over the four roads');
  for (const [k, t] of Object.entries(out)) log(k.padEnd(24), `spins ${t.spins}  excursions ${t.excursions}  spins+exc ${t.spins + t.excursions}  resets ${t.resets}  km ${t.km.toFixed(2)}  offRoad% ${(t.offRoadPct / t.n).toFixed(2)}  peak latG ${t.latG.toFixed(2)}`);
  return out;
}

// The diagnosis (0108): every road (the four baked ones and the endless road), Standard and Easy (and Free
// Drive's AI assist), with drivers who read the road (keys, a thumb on the stick, a tilted phone) and naive
// input that doesn't (NAIVE). Exits and rail hits per km, spins, the first loss of control, the pace.
export const DIAG_ROADS = ['stelvio', 'transfagarasan', 'bigsur', 'atlantic', 'endless'];
export const DIAG_DRIVERS = [
  { name: 'eye keys', device: 'keys' }, { name: 'eye touch', device: 'touch' }, { name: 'eye tilt', device: 'tilt' },
  ...NAIVE.map((k) => ({ name: `${k} keys`, device: 'keys', naive: k })),
  { name: 'mash touch', device: 'touch', naive: 'mash' }, { name: 'mash tilt', device: 'tilt', naive: 'mash' },
];
export async function diag(log = console.log, { secs = 60, modes = ['standard', 'easy', 'ai'], roads = DIAG_ROADS, drivers = DIAG_DRIVERS } = {}) {
  const out = {};
  for (const id of roads) {
    const road = await loadRoad(id);
    for (const d of drivers) for (const mode of modes) {
      const ai = mode === 'ai', level = ai ? 'standard' : mode;
      const r = await roadDrive(road, { level, ai, device: d.device, naive: d.naive || null, push: 1.25, react: 0.25, secs, seed: 3 });
      const t = (out[`${mode}|${d.name}`] ||= { exits: 0, spins: 0, rails: 0, km: 0, firstLoss: Infinity, kmh: 0, n: 0 });
      t.exits += r.excursions; t.spins += r.spins; t.rails += r.rails; t.km += r.km - (road.endless ? 0.06 : 0.018); t.kmh += r.avgKmh; t.n++;
      t.firstLoss = Math.min(t.firstLoss, r.firstLoss);
      log(`${id.padEnd(15)} ${d.name.padEnd(12)} ${mode.padEnd(8)}`, `exits ${r.excursions}  spins ${r.spins}  rails ${r.rails}  exits/km ${r.exitsKm.toFixed(2)}  rails/km ${r.railsKm.toFixed(2)}  firstLoss ${Number.isFinite(r.firstLoss) ? r.firstLoss.toFixed(1) + ' s' : '—'}  avg ${r.avgKmh.toFixed(0)} km/h  resets ${r.resets}`);
    }
  }
  log('--- totals over the roads');
  for (const [k, t] of Object.entries(out)) log(k.padEnd(24), `exits ${t.exits}  spins ${t.spins}  rails ${t.rails}  exits/km ${(t.exits / t.km).toFixed(2)}  rails/km ${(t.rails / t.km).toFixed(2)}  first loss ${Number.isFinite(t.firstLoss) ? t.firstLoss.toFixed(1) + ' s' : 'never'}  avg ${(t.kmh / t.n).toFixed(0)} km/h`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await initPhysics();
  const [what = 'all', tierArg] = process.argv.slice(2);
  const tiers = tierArg ? [tierArg] : ['assist', 'pro'];
  if (what === 'all' || what === 'bench') for (const t of tiers) { console.log(`--- ${t}`); bench(t); }
  if (what === 'bench-levels') for (const l of ['easy', 'standard', 'advanced']) { console.log(`--- ${l}`); bench('assist', console.log, l); }
  if (what === 'levels') await levels();
  if (what === 'diag') await diag(console.log, { modes: (process.argv[3] || 'standard,easy,ai').split(','), roads: process.argv[4] ? process.argv[4].split(',') : DIAG_ROADS });
  if (what === 'all' || what === 'road') {
    for (const id of ['stelvio', 'transfagarasan', 'bigsur', 'atlantic']) {
      const road = await loadRoad(id);
      for (const t of tiers) for (const push of [0.8, 1.1]) {
        const r = await roadDrive(road, { tier: t, push, secs: 60 });
        console.log(`${id.padEnd(15)} ${t.padEnd(6)} push ${push}`, Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
      }
    }
  }
}
