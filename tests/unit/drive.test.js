// Driving feel (SIM_VERSION 21): the manoeuvres a test driver runs, through the same hands a
// player has (src/hands.js: keys, a thumb on the stick, a gamepad), on open concrete and on a real
// road. The numbers before each fix are in the CHANGELOG (2026-10-21, "Driving feel 2").
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createVehicle, step, newInput, rackLock } from '../../src/sim/vehicle.js';
import { quatFromYaw } from '../../src/sim/m3.js';
import { SPEC } from '../../src/sim/spec.js';
import { createHands, createReverse, stickShape } from '../../src/hands.js';
import { createPoseLerp } from '../../src/render/interp.js';
import { parseRoad, buildRoad, createRoadCourse, poseAt } from '../../src/sim/roads.js';

const KM = 3.6;
const spd = (s) => Math.hypot(s.vel.x, s.vel.z);
const yawRight = (s) => -s.angVel.y;
// Heading (+ = left of +z) and body-frame velocities: forward, lateral (+ = the car's left).
function body(s) {
  const q = s.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return { vf: s.vel.x * fx + s.vel.z * fz, vl: s.vel.x * fz - s.vel.z * fx, heading: Math.atan2(fx, fz) };
}
const betaDeg = (s) => { const b = body(s); return (Math.atan2(b.vl, Math.abs(b.vf)) * 180) / Math.PI; };
// A settled car on the Lineup's concrete, far from the row, pointing up +z.
function settled() {
  const s = createVehicle('lineup'); s.pos.x = 200; s.pos.z = -600;
  for (let i = 0; i < 240; i++) step(s, newInput());
  return s;
}
// A driver on the keyboard: keys → hands → the sim, with an optional right foot holding a speed.
function driver(tier = 'assist') {
  const h = createHands();
  return (s, keys = {}) => {
    const inp = h.keyboard(keys, s, tier);
    if (keys.cruise != null) { inp.throttle = Math.max(0, Math.min(1, (keys.cruise - spd(s)) * 0.5 + 0.12)); inp.brake = 0; }
    return inp;
  };
}
function atSpeed(kmh, tier = 'assist') {
  const s = settled(), d = driver(tier);
  while (spd(s) < kmh / KM) step(s, d(s, { up: 1 }));
  for (let i = 0; i < 240; i++) step(s, d(s, { cruise: kmh / KM }));
  return { s, d };
}

describe('steering at road speed (keyboard)', () => {
  it('a held key at 100 km/h: the yaw rate settles without a big overshoot, at ≈1.1 g, and lets go straight', () => {
    const { s, d } = atSpeed(100);
    const tr = [];
    for (let i = 0; i < 240 * 2.5; i++) { step(s, d(s, { right: 1, cruise: 100 / KM })); tr.push(yawRight(s)); }
    const ss = tr.slice(-120).reduce((a, b) => a + b, 0) / 120, peak = Math.max(...tr);
    expect(ss).toBeGreaterThan(0);
    expect(peak / ss - 1).toBeLessThan(0.2);                       // was 16 %, holds under 20 %
    expect((ss * spd(s)) / 9.81).toBeGreaterThan(1.0);
    expect((ss * spd(s)) / 9.81).toBeLessThan(1.25);
    let t0 = -1;
    for (let i = 0; i < 240 * 2; i++) { step(s, d(s, { cruise: 100 / KM })); if (t0 < 0 && Math.abs(yawRight(s)) < 0.02) t0 = i / 240; }
    expect(t0).toBeGreaterThan(0);
    expect(t0).toBeLessThan(0.6);
    expect(Math.abs(yawRight(s))).toBeLessThan(0.005);              // and stays straight: no wander
  });
  it('a lane change at 100 km/h (R 0.4 s, L 0.4 s) ends parallel, a lane over, calm', () => {
    const { s, d } = atSpeed(100);
    const b0 = body(s), x0 = s.pos.x;
    let lat = 0;
    for (let i = 0; i < 240 * 4; i++) {
      const t = i / 240;
      step(s, d(s, { right: t < 0.4, left: t > 0.55 && t < 0.95, cruise: 100 / KM }));
      lat = Math.max(lat, (spd(s) * Math.abs(s.angVel.y)) / 9.81);
    }
    expect(-(s.pos.x - x0)).toBeGreaterThan(1);                     // moved right
    expect(Math.abs(body(s).heading - b0.heading)).toBeLessThan(0.5 * Math.PI / 180);
    expect(Math.abs(yawRight(s))).toBeLessThan(0.005);
    expect(lat).toBeLessThan(1.0);                                  // a calm lane change, not a swerve
  });
  it('on-centre at 130 km/h: a yaw kick dies out within a second, hands off', () => {
    const { s, d } = atSpeed(130);
    const h0 = body(s).heading;
    s.angVel.y += 0.05; s.angMom.y += 0.05 * SPEC.inertia.yaw;
    for (let i = 0; i < 240; i++) step(s, d(s, { cruise: 130 / KM }));
    expect(Math.abs(yawRight(s))).toBeLessThan(0.005);
    expect(Math.abs(body(s).heading - h0)).toBeLessThan(0.5 * Math.PI / 180);
  });
});

describe('braking and power', () => {
  it('60 mph to 0 on the key in ≈33 m, dead straight', () => {
    const { s } = atSpeed(26.82 * KM);
    const d = driver(), z0 = s.pos.z, x0 = s.pos.x;
    let t = 0;
    while (spd(s) > 0.3 && t < 10) { step(s, d(s, { down: 1 })); t += 1 / 240; }
    expect(s.pos.z - z0).toBeLessThan(35);
    expect(s.pos.z - z0).toBeGreaterThan(28);
    expect(Math.abs(s.pos.x - x0)).toBeLessThan(0.1);
  });
  it('full throttle with full lock from 40 km/h does not spin the car (was 55° of slide), in Assist or Pro', () => {
    for (const tier of ['assist', 'pro']) {
      const { s, d } = atSpeed(40, tier);
      let maxBeta = 0;
      for (let i = 0; i < 240 * 2; i++) { step(s, d(s, { right: 1, up: 1 })); maxBeta = Math.max(maxBeta, Math.abs(betaDeg(s))); }
      expect(maxBeta).toBeLessThan(6);
      expect(spd(s) * KM).toBeGreaterThan(50);                      // and it still pulls
    }
  });
});

describe('catching a slide', () => {
  // The tail kicked out: the nose 20° left of the travel and still rotating at 1.2 rad/s, at 70 km/h.
  function kicked(tier) {
    const { s, d } = atSpeed(70, tier);
    const v = spd(s);
    quatFromYaw(s.quat, (20 * Math.PI) / 180);
    s.vel.x = 0; s.vel.z = v; s.angVel.x = s.angVel.z = 0; s.angMom.x = s.angMom.z = 0;
    s.angVel.y = 1.2; s.angMom.y = SPEC.inertia.yaw * 1.2;
    return { s, d };
  }
  const recover = (tier, counter) => {
    const { s, d } = kicked(tier);
    for (let i = 0; i < 240 * 3; i++) {
      step(s, d(s, { right: counter && betaDeg(s) < -3 }));
      if (i > 10 && Math.abs(betaDeg(s)) < 3) return i / 240;
    }
    return Infinity;
  };
  it('Pro: opposite lock on the key catches it (the rack used to hold 7.6° either way at 70 km/h: never caught)', () => {
    expect(recover('pro', true)).toBeLessThan(2);
  });
  it('Assist: stability control catches it with the hands off', () => {
    expect(recover('assist', false)).toBeLessThan(1);
  });
  it('the rack opens up in the direction that catches the slide, never the other way, and never on its own', () => {
    const { s } = kicked('pro');
    const inp = newInput();
    inp.assist = 0;
    step(s, inp);
    expect(Math.abs(s.steer)).toBe(0);                              // stick centred: wheels straight
    const lock = rackLock(s.vel.x * s.vel.x + s.vel.z * s.vel.z);
    inp.steer = 1;                                                  // full right: the catching way
    for (let i = 0; i < 40; i++) step(s, inp);
    expect(-s.steer).toBeGreaterThan(lock * 1.5);
  });
});

describe('the hands', () => {
  it('a key is a steering wheel turned by hand: slower at speed, back to centre fast', () => {
    const h = createHands();
    let n = 0;
    while (h.steer(1, 0) < 1) n++;
    expect(n / 240).toBeCloseTo(0.25, 1);
    h.reset(); n = 0;
    while (h.steer(1, 120 / KM) < 1) n++;
    expect(n / 240).toBeGreaterThan(0.9);
    n = 0;
    while (h.steer(0, 120 / KM) > 0) n++;
    expect(n / 240).toBeLessThan(0.15);
  });
  it('a stick moves the wheel 4× as fast as a key, and its dead zone starts from zero', () => {
    const h = createHands();
    let n = 0;
    while (h.steer(1, 100 / KM, true) < 1) n++;
    const k = createHands();
    let m = 0;
    while (k.steer(1, 100 / KM) < 1) m++;
    expect(m / n).toBeCloseTo(4, 0);
    expect(stickShape(0.1)).toBe(0);
    expect(stickShape(0.13)).toBeGreaterThan(0);
    expect(stickShape(0.13)).toBeLessThan(0.02);
    expect(stickShape(1)).toBeCloseTo(1, 9);
    expect(stickShape(-0.5)).toBeCloseTo(-stickShape(0.5), 12);
    for (let x = 0.12; x < 1; x += 0.01) expect(stickShape(x + 0.01)).toBeGreaterThan(stickShape(x));
  });
  it('the brake held from speed stops the car and holds it before it reverses', () => {
    const { s } = atSpeed(30);
    const d = driver(), rev = createReverse();
    let stopT = -1, backT = -1;
    for (let i = 0; i < 240 * 6; i++) {
      const inp = rev(s, d(s, { down: 1 }));
      step(s, inp);
      const vf = body(s).vf;
      if (stopT < 0 && vf < 0.8) stopT = i / 240;
      if (backT < 0 && vf < -0.3) backT = i / 240;
    }
    expect(stopT).toBeGreaterThan(0);
    expect(backT - stopT).toBeGreaterThan(0.3);
    expect(body(s).vf).toBeLessThan(-1);                            // and then it does back up
  });
});

describe('the car drawn between ticks', () => {
  it('is drawn the fraction of a tick the clock has reached, and as is after a reset', () => {
    const s = settled(), lerp = createPoseLerp(), d = driver();
    while (spd(s) < 20) { lerp.before(s); step(s, d(s, { up: 1 })); }
    const z1 = s.pos.z;
    lerp.before(s);
    step(s, d(s, { up: 1 }));
    const p = lerp.pose(s, 0.25);
    expect(p.pos.z).toBeCloseTo(z1 + 0.25 * (s.pos.z - z1), 9);
    expect(lerp.pose(s, 1).pos.z).toBeCloseTo(s.pos.z, 9);
    const fresh = settled();
    expect(lerp.pose(fresh, 0.5).pos).toBe(fresh.pos);
  });
});

describe('on a real road', () => {
  let road;
  beforeAll(() => {
    const raw = gunzipSync(readFileSync(new URL('../../public/roads/stelvio.bin.gz', import.meta.url)));
    road = buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  });
  it('Assist keeps pulling up the Stelvio: the crawl limit belongs to the Wall (it held the car to 32 km/h on any 6° grade)', () => {
    const c = createVehicle(createRoadCourse(road, { name: 'test' }));
    const p = poseAt(road, 18, 1);
    c.pos.x = p.x; c.pos.y = p.y + SPEC.comHeight + 0.04; c.pos.z = p.z; quatFromYaw(c.quat, p.yaw);
    expect(c.crawl).toBe(false);
    expect(createVehicle('wall').crawl).toBe(true);
    const d = driver('assist');
    // Floored, dead straight up the first stretch (11 % grade): it keeps pulling. Before, drive
    // torque was cut at 3.3 s (78 km/h) and the car slowed with the pedal down.
    let v33 = 0;
    for (let i = 0; i < 240 * 4.5; i++) { step(c, d(c, { up: 1 })); if (i === 240 * 3.3) v33 = spd(c); }
    expect(spd(c) * KM).toBeGreaterThan(88);
    expect(spd(c)).toBeGreaterThan(v33 + 2);
  });
});
