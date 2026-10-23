// Driving levels (0066, src/driving.js): one setting, Easy / Standard / Advanced, for the ground in every
// mode. Standard must be today's hands bit for bit; Easy must keep a newcomer on the road; Advanced must
// be direct. The level only ever writes the ordinary input channels (and, on an unscored ground, the
// car's TC/ABS/handbrake flags, which a scored run never sets).
import { describe, it, expect } from 'vitest';
import { createVehicle, step, newInput } from '../../src/sim/vehicle.js';
import { createHands, stickShape } from '../../src/hands.js';
import {
  createDriver, shapeStick, applyGround, loadDriving, saveDriving, defaultLevel, roadSpeed, LEVELS, EASY,
} from '../../src/driving.js';
import { loadRoad, roadDrive } from '../../scripts/drive-feel.mjs';

const spd = (s) => Math.hypot(s.vel.x, s.vel.z);
function settled() {
  const s = createVehicle('lineup'); s.pos.x = 200; s.pos.z = -600;
  for (let i = 0; i < 240; i++) step(s, newInput());
  return s;
}
const raw = (o = {}) => ({ keyAx: 0, stickAx: 0, tilt: 0, up: false, down: false, thrA: 0, brkA: 0, hb: 0, ...o });
// A car state the aids can read without a sim: heading +z, moving at v (m/s), sliding by `slip` rad.
const fakeCar = (v, { slip = 0, x = 0, z = 0 } = {}) => ({
  pos: { x, y: 0, z }, vel: { x: v * Math.sin(slip), y: 0, z: v * Math.cos(slip) }, angVel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
});
// A road along +z: `straight` metres, then a bend of radius R to the right, 2 m samples, 7 m wide.
function testRoad(straight = 300, R = 30, hw = 3.5) {
  const sp = 2, xs = [], zs = [];
  for (let s = 0; s <= straight; s += sp) { xs.push(0); zs.push(s); }
  for (let a = sp / R; a < Math.PI; a += sp / R) { xs.push(-R + R * Math.cos(a)); zs.push(straight + R * Math.sin(a)); }
  const n = xs.length, dx = new Float64Array(n), dz = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) { const l = Math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i]); dx[i] = (xs[i + 1] - xs[i]) / l; dz[i] = (zs[i + 1] - zs[i]) / l; }
  return { n, m: n - 1, x: Float64Array.from(xs), z: Float64Array.from(zs), dx, dz, hw: new Float64Array(n).fill(hw), meta: { spacing: sp } };
}

describe('the setting', () => {
  it('starts on Easy on a touch-first device and Standard elsewhere, and remembers a choice', () => {
    expect(defaultLevel(true)).toBe('easy');
    expect(defaultLevel(false)).toBe('standard');
    const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    expect(loadDriving(true, store)).toMatchObject({ level: 'easy', tc: 'on', abs: true, saved: false });
    saveDriving({ level: 'advanced', tc: 'sport', abs: false }, store);
    expect(loadDriving(true, store)).toMatchObject({ level: 'advanced', tc: 'sport', abs: false, saved: true });
    expect(loadDriving(false, store).level).toBe('advanced');
  });
  it('blocked or junk storage gives the defaults, never a throw', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
    expect(loadDriving(false, blocked).level).toBe('standard');
    expect(() => saveDriving({ level: 'easy', tc: 'on', abs: true }, blocked)).not.toThrow();
    const junk = { getItem: () => '{"level":"insane","tc":7}' };
    expect(loadDriving(true, junk)).toMatchObject({ level: 'easy', tc: 'on' });
    expect(LEVELS).toEqual(['easy', 'standard', 'advanced']);
  });
});

describe('Standard is today\'s driving, bit for bit', () => {
  it('hands the flight its wheel and pedals (src/input.js steers the air with driver.hands)', () => {
    for (const level of ['easy', 'standard', 'advanced']) {
      const d = createDriver(level);
      expect(typeof d.hands.steer).toBe('function');
      expect(typeof d.hands.pedals).toBe('function');
    }
  });
  it('keys, a stick, the pedals and the tilt make exactly what the old hands made', () => {
    const d = createDriver('standard'), h = createHands();
    const car = settled();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) {
      const r = raw({ keyAx: [0, 1, -1, 0][(i >> 6) & 3], stickAx: (i >> 8) & 1 ? stickShape(rnd() * 2 - 1) : 0, tilt: (i >> 9) & 1 ? 0.25 : 0, up: rnd() > 0.4, down: rnd() > 0.85, thrA: (i >> 7) & 1 ? rnd() : 0 });
      car.vel.z = (i % 900) / 20;
      const o = d.tick(r, car, null);
      const v = Math.sqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z);
      const ax = h.steer(Math.max(-1, Math.min(1, r.keyAx + r.stickAx)), v, r.keyAx === 0 && r.stickAx !== 0) + r.tilt;
      const p = h.pedals(r.up, r.down);
      expect(o.steer).toBe(ax);
      expect(o.throttle).toBe(Math.max(p.thr, r.thrA));
      expect(o.brake).toBe(p.brk);
      expect(o.ground).toBe(null);   // a scored run: the flight tier keeps assist/manual
    }
  });
  it('its stick shaping is the one input.js always used (touch 15 % dead zone, pad 12 %)', () => {
    for (let x = -1; x <= 1; x += 0.05) {
      expect(shapeStick('standard', x, 'touch')).toBe(stickShape(x, 0.15, 0.3));
      expect(shapeStick('standard', x, 'pad')).toBe(stickShape(x));
    }
  });
  it('on an unscored ground it is Assist driving: stability control on, a stock car', () => {
    const o = createDriver('standard').tick(raw(), fakeCar(20), { free: true });
    expect(o.ground).toMatchObject({ assist: 1, manual: 0, tcOff: false, tcSport: false, absOff: false, handbrake: 0 });
  });
});

describe('Easy', () => {
  it('a softer stick: a bigger dead zone and the middle of the travel finer', () => {
    expect(shapeStick('easy', 0.18, 'touch')).toBe(0);
    expect(shapeStick('standard', 0.18, 'touch')).toBeGreaterThan(0);
    expect(Math.abs(shapeStick('easy', 0.5, 'pad'))).toBeLessThan(Math.abs(shapeStick('standard', 0.5, 'pad')));
    expect(shapeStick('easy', 1, 'touch')).toBeCloseTo(1, 9);
  });
  it('speed-sensitive steering: at 120 km/h full key is less wheel than Standard; at a crawl the same', () => {
    for (const [v, less] of [[33, true], [3, false]]) {
      const e = createDriver('easy'), s = createDriver('standard');
      let oe, os;
      for (let i = 0; i < 480; i++) { oe = e.tick(raw({ keyAx: 1 }), fakeCar(v)).steer; os = s.tick(raw({ keyAx: 1 }), fakeCar(v)).steer; }
      if (less) expect(oe).toBeLessThan(os * 0.85); else expect(oe).toBeCloseTo(os, 6);
    }
  });
  it('a gentle throttle: twice as long to full, and held inside the friction ellipse while steering', () => {
    const e = createDriver('easy'), s = createDriver('standard');
    let ne = 0, ns = 0;
    while (e.tick(raw({ up: true }), fakeCar(0)).throttle < 1) ne++;
    while (s.tick(raw({ up: true }), fakeCar(0)).throttle < 1) ns++;
    expect(ne / ns).toBeCloseTo(2, 0);
    const c = createDriver('easy');
    let o;
    for (let i = 0; i < 480; i++) o = c.tick(raw({ up: true, keyAx: 1 }), fakeCar(25));
    expect(o.throttle).toBeLessThan(1 - EASY.ellipse * Math.abs(o.steer) + 1e-9);
    expect(o.throttle).toBeLessThan(0.7);
  });
  it('a slide is caught: opposite lock and a lift, with the hands off', () => {
    const e = createDriver('easy');
    const o = e.tick(raw({ up: true }), fakeCar(25, { slip: 0.25 }));   // the velocity 14° left of the nose
    expect(o.steer).toBeLessThan(-0.3);   // steer left, toward the travel
    expect(o.throttle).toBe(0);
    expect(e.aid.catch).toBeGreaterThan(0);
  });
  it('the governor brakes for a bend the tyres can\'t take, before it', () => {
    const road = testRoad(300, 30);
    expect(roadSpeed(road, 100, 1, 40)).toBeLessThan(40);
    expect(roadSpeed(road, 100, 1, 40)).toBeGreaterThan(Math.sqrt(EASY.aLat * 30));
    const e = createDriver('easy');
    // 60 m before a 30 m bend at 30 m/s (108 km/h), throttle held: off it and braking.
    const o = e.tick(raw({ up: true }), fakeCar(30, { z: 240 }), { free: true, road });
    expect(o.throttle).toBe(0);
    expect(o.brake).toBeGreaterThan(0.1);
    expect(e.aid.governor).toBeGreaterThan(0);
    // Far from any bend, at a gentle speed: no intervention.
    const f = createDriver('easy');
    const o2 = f.tick(raw({ up: true }), fakeCar(12, { z: 20 }), { free: true, road });
    expect(o2.brake).toBe(0);
    expect(f.aid.governor).toBe(0);
  });
  it('a newcomer\'s top speed on a road, and nothing like it off one (the Show\'s run-up)', () => {
    const road = testRoad(3000, 300);
    const e = createDriver('easy');
    expect(e.tick(raw({ up: true }), fakeCar(40, { z: 10 }), { free: true, road }).brake).toBeGreaterThan(0);
    const show = createDriver('easy');
    expect(show.tick(raw({ up: true }), fakeCar(40), null).brake).toBe(0);
  });
  it('lane keeping: near the edge it steers back toward the road', () => {
    const road = testRoad(300, 30, 3.5);
    const left = createDriver('easy'), right = createDriver('easy');
    // +x is the car's left (heading +z): 3 m left of the centreline, then 3 m right.
    expect(left.tick(raw(), fakeCar(15, { x: 3, z: 50 }), { free: true, road }).steer).toBeGreaterThan(0.05);
    expect(right.tick(raw(), fakeCar(15, { x: -3, z: 50 }), { free: true, road }).steer).toBeLessThan(-0.05);
    // In the lane, hands off, going straight: it leaves the wheel alone.
    expect(createDriver('easy').tick(raw(), fakeCar(15, { x: -1.6, z: 50 }), { free: true, road }).steer).toBe(0);
  });
});

describe('Advanced', () => {
  it('direct: the stick is the wheel at any speed, a key is full lock in 0.08 s, the pedals are analog', () => {
    const a = createDriver('advanced');
    expect(a.tick(raw({ stickAx: 0.4 }), fakeCar(40)).steer).toBe(0.4);
    const k = createDriver('advanced');
    let n = 0;
    while (k.tick(raw({ keyAx: 1 }), fakeCar(40)).steer < 1) n++;
    expect(n / 240).toBeCloseTo(0.08, 2);
    const p = createDriver('advanced').tick(raw({ thrA: 0.37, brkA: 0.2 }), fakeCar(10));
    expect(p.throttle).toBe(0.37); expect(p.brake).toBe(0.2);
    expect(shapeStick('advanced', 0.5, 'pad')).toBeGreaterThan(shapeStick('standard', 0.5, 'pad'));
  });
  it('unscored: ESC off, TC On / Sport / Off, ABS your call, the handbrake; scored: the flight tier\'s', () => {
    const a = createDriver('advanced', { tc: 'off', abs: false });
    expect(a.tick(raw({ hb: 1 }), fakeCar(20), { free: true }).ground).toMatchObject({ assist: 0, manual: 0, tcOff: true, tcSport: false, absOff: true, handbrake: 1 });
    a.set('advanced', { tc: 'sport', abs: true });
    expect(a.tick(raw(), fakeCar(20), { free: true }).ground).toMatchObject({ tcOff: false, tcSport: true, absOff: false, handbrake: 0 });
    expect(a.tick(raw({ hb: 1 }), fakeCar(20), null).ground).toBe(null);
  });
  it('applyGround puts the level on the car on the ground and takes it off in the air', () => {
    const car = settled(), inp = newInput();
    applyGround({ assist: 0, manual: 0, tcOff: true, tcSport: false, absOff: true, handbrake: 1 }, inp, car, false);
    expect([inp.assist, car.tcOff, car.absOff, car.handbrake]).toEqual([0, true, true, 1]);
    applyGround(null, inp, car, true);
    expect([car.tcOff, car.tcSport, car.absOff, car.handbrake]).toEqual([false, false, false, 0]);
  });
});

describe('the car\'s drivetrain flags (unscored grounds only)', () => {
  const atSpeed = (v) => { const s = settled(), inp = newInput(); inp.throttle = 1; while (spd(s) < v) step(s, inp); return s; };
  it('a stock car is untouched: the flags default off', () => {
    const s = createVehicle('lineup');
    expect([s.tcOff, s.tcSport, s.absOff, s.handbrake]).toEqual([false, false, false, 0]);
  });
  it('the handbrake locks the rear wheels at speed; the fronts keep turning', () => {
    const s = atSpeed(20), inp = newInput();
    s.handbrake = 1;
    for (let i = 0; i < 60; i++) step(s, inp);
    expect(s.wheels[2].omega).toBe(0); expect(s.wheels[3].omega).toBe(0);
    expect(Math.abs(s.wheels[0].omega)).toBeGreaterThan(10);
  });
  it('ABS off locks the wheels in a hard stop; on, it never does', () => {
    for (const off of [false, true]) {
      const s = atSpeed(25), inp = newInput();
      inp.brake = 1; s.absOff = off;
      let locked = 0;
      for (let i = 0; i < 120; i++) { step(s, inp); if (s.wheels[0].omega === 0 && spd(s) > 5) locked++; }
      if (off) expect(locked).toBeGreaterThan(20); else expect(locked).toBe(0);
    }
  });
  it('TC off spins the rears up from a standstill; on, it holds them near the slip peak', () => {
    const slip = (off) => {
      const s = settled(), inp = newInput(); inp.throttle = 1; s.tcOff = off;
      let worst = 0;
      for (let i = 0; i < 240; i++) { step(s, inp); worst = Math.max(worst, s.wheels[2].omega * 0.37 - spd(s)); }
      return worst;
    };
    expect(slip(true)).toBeGreaterThan(slip(false) * 1.5);
  });
});

describe('on the real roads (scripts/drive-feel.mjs levels)', () => {
  it('Easy halves the spins and excursions of a naive driver, keys and touch stick', async () => {
    let std = 0, easy = 0;
    for (const id of ['stelvio', 'atlantic']) {
      const road = await loadRoad(id);
      for (const device of ['keys', 'touch']) {
        const a = await roadDrive(road, { level: 'standard', device, push: 1.25, react: 0.25, secs: 45 });
        const b = await roadDrive(road, { level: 'easy', device, push: 1.25, react: 0.25, secs: 45 });
        std += a.spins + a.excursions; easy += b.spins + b.excursions;
      }
    }
    expect(std).toBeGreaterThan(4);
    expect(easy).toBeLessThanOrEqual(std * 0.5);
  }, 120_000);
});
