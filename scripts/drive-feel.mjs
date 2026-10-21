// Driving feel bench: the manoeuvres a test driver runs, through the same keyboard hands a player
// has (src/hands.js), on open concrete. node scripts/drive-feel.mjs [assist|pro]
import { createVehicle, step, newInput, DT } from '../src/sim/vehicle.js';
import { initPhysics } from '../src/sim/engine.js';
import { createHands } from '../src/hands.js';

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
export function kbHands(tier = 'assist') {
  const k = createHands();
  return {
    reset: () => k.reset(),
    tick(s, keys) {
      const inp = k.keyboard(keys, s, tier);
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

export function bench(tier = 'assist', log = console.log) {
  const out = {};
  const report = (name, o) => { out[name] = o; log(name.padEnd(30), Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(Math.abs(v) < 10 ? 3 : 1)}`).join('  ')); };
  const h = kbHands(tier);
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
  const { readFileSync } = await import('node:fs');
  const { gunzipSync } = await import('node:zlib');
  const { parseRoad, buildRoad } = await import('../src/sim/roads.js');
  const raw = gunzipSync(readFileSync(new URL(`../public/roads/${id}.bin.gz`, import.meta.url)));
  return buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
}
export async function roadDrive(road, { tier = 'assist', secs = 90, push = 1.0, react = 0.18, start = 18, pilot = null, vmax = 45, analog = false } = {}) {
  const { createRoadCourse, poseAt, nearestSample } = await import('../src/sim/roads.js');
  const drive = pilot ? (await import('../src/drive/pilot.js')).createPilot(road, pilot) : null;
  const { quatFromYaw } = await import('../src/sim/m3.js');
  const { SPEC } = await import('../src/sim/spec.js');
  const course = createRoadCourse(road, { name: 'bench' });
  const c = createVehicle(course);
  const p0 = poseAt(road, start, 1);
  c.pos.x = p0.x; c.pos.y = p0.y + SPEC.comHeight + 0.04; c.pos.z = p0.z; quatFromYaw(c.quat, p0.yaw);
  const k = createHands();
  const sp = road.meta.spacing;
  const eye = (await import('../src/drive/pilot.js')).createPilot(road, { vmax, lat: push });
  let hint = p0.i, maxBeta = 0, offRoad = 0, rail = 0, railWas = false, resets = 0, maxOff = 0, se = 0, ns = 0;
  const delay = Math.round(react * 240), seen = [];
  let keys = { left: 0, right: 0, up: 0, down: 0 }, stuck = 0;
  const N = secs * 240;
  for (let n = 0; n < N; n++) {
    hint = nearestSample(road, c.pos.x, c.pos.z, hint, 40);
    const q = c.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const v = Math.hypot(c.vel.x, c.vel.z);
    // What they see now (where the road goes, how fast they'd take the bend: the road pilot's eye),
    // acted on `react` later with whole keys, against how far the wheel has already gone.
    const want = eye(c);
    seen.push({ steer: want.steer, thr: want.throttle, brk: want.brake });
    const o = seen.length > delay ? seen.shift() : seen[0];
    const err = o.steer - k.ax;
    const band = 0.03 + 0.05 * Math.abs(o.steer);
    keys.right = err > band ? 1 : err < -band ? 0 : keys.right && err > 0 ? 1 : 0;
    keys.left = err < -band ? 1 : err > band ? 0 : keys.left && err < 0 ? 1 : 0;
    keys.up = o.thr > 0.35 ? 1 : 0;
    keys.down = o.brk > 0.15 ? 1 : 0;
    const inp = drive ? drive(c) : k.keyboard(keys, c, tier);
    if (analog) inp.steer = Math.max(-1, Math.min(1, o.steer));
    // Reverse is the drive's own rule (src/drive/index.js); a stuck driver backs off and resets.
    globalThis.__trace?.(c, inp, n);
    step(c, inp);
    const b = bodyV(c);
    if (v > 5) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(b.vl, Math.abs(b.vf))) * 57.3);
    const hm = Math.min(hint, road.m - 1);
    const off = Math.abs((c.pos.x - road.x[hint]) * road.dz[hm] - (c.pos.z - road.z[hint]) * road.dx[hm]);
    const lat = (c.pos.x - road.x[hint]) * road.dz[hm] - (c.pos.z - road.z[hint]) * road.dx[hm];   // + left
    if (v > 5) { const e = lat + Math.min(1.6, road.hw[hint] * 0.4); se += e * e; ns++; }
    maxOff = Math.max(maxOff, off);
    if (off > road.hw[hint] + 0.2) offRoad++;
    const hitRail = c.hullContact && off > road.hw[hint] - 1.3;
    if (hitRail && !railWas) rail++;
    railWas = hitRail;
    stuck = v < 1 ? stuck + 1 : 0;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (stuck > 240 * 2 || off > 30 || upY < 0.2) {
      resets++;
      const pr = poseAt(road, Math.min(road.length - 6, hint * sp + 3), 1);
      c.pos.x = pr.x; c.pos.y = pr.y + SPEC.comHeight + 0.04; c.pos.z = pr.z; quatFromYaw(c.quat, pr.yaw);
      c.vel.x = c.vel.y = c.vel.z = 0; c.angVel.x = c.angVel.y = c.angVel.z = 0; c.angMom.x = c.angMom.y = c.angMom.z = 0;
      c.engineHeld = false; stuck = 0; seen.length = 0;
    }
    if (hint >= road.n - 10) break;
  }
  return { km: (hint * sp) / 1000, kmh: (hint * sp) / secs * 3.6, offRoadPct: (offRoad / N) * 100, rails: rail, resets, maxBetaDeg: maxBeta, maxOff, laneRms: Math.sqrt(se / Math.max(1, ns)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await initPhysics();
  const [what = 'all', tierArg] = process.argv.slice(2);
  const tiers = tierArg ? [tierArg] : ['assist', 'pro'];
  if (what === 'all' || what === 'bench') for (const t of tiers) { console.log(`--- ${t}`); bench(t); }
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
