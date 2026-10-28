// Free Drive's AI drive (0109, src/driving.js): the computer holds the car on the road (pure pursuit along
// the lane, a safe speed from the bends ahead, slides caught) and the player gives intent (GO sets the pace,
// steer moves across the road, a hard sustained steer takes the wheel inside the edges). Pure, writes only
// the ordinary input channels, never on a scored run (no road in the context: the level drives as before).
import { describe, it, expect } from 'vitest';
import { createDriver, loadDriving, saveDriving, roadSpeed, AI } from '../../src/driving.js';
import { loadRoad, roadDrive, NAIVE } from '../../scripts/drive-feel.mjs';

const raw = (o = {}) => ({ keyAx: 0, stickAx: 0, tilt: 0, up: false, down: false, thrA: 0, brkA: 0, hb: 0, ...o });
// A car the controller can read without a sim: heading +z at speed v, `x` metres across (+x is the car's LEFT).
const fakeCar = (v, { x = 0, z = 0 } = {}) => ({
  pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: v }, angVel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
});
// A road along +z: `straight` metres, then a bend of radius R to the right, 2 m samples, 7 m wide.
function testRoad(straight = 300, R = 30, hw = 3.5) {
  const sp = 2, xs = [], zs = [];
  for (let s = 0; s <= straight; s += sp) { xs.push(0); zs.push(s); }
  for (let a = sp / R; a < Math.PI; a += sp / R) { xs.push(-R + R * Math.cos(a)); zs.push(straight + R * Math.sin(a)); }
  const n = xs.length, dx = new Float64Array(n), dz = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) { const l = Math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i]); dx[i] = (xs[i + 1] - xs[i]) / l; dz[i] = (zs[i + 1] - zs[i]) / l; }
  dx[n - 1] = dx[n - 2]; dz[n - 1] = dz[n - 2];
  return { n, m: n - 1, x: Float64Array.from(xs), z: Float64Array.from(zs), dx, dz, hw: new Float64Array(n).fill(hw), meta: { spacing: sp } };
}
const run = (d, r, car, ctx, n) => { let o; for (let i = 0; i < n; i++) o = d.tick(r, car, ctx); return o; };

describe('the setting', () => {
  it('is on for a player with no saved choice, and a choice is remembered', () => {
    const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    expect(loadDriving(true, store)).toMatchObject({ level: 'standard', ai: true });
    saveDriving({ level: 'standard', tc: 'on', abs: true, ai: false }, store);
    expect(loadDriving(true, store)).toMatchObject({ ai: false });
    saveDriving({ level: 'easy', tc: 'on', abs: true, ai: true }, store);
    expect(loadDriving(false, store)).toMatchObject({ level: 'easy', ai: true });
    // A setting saved before 0109 (no `ai`): on.
    mem.set('coldgas_driving', JSON.stringify({ level: 'advanced', tc: 'on', abs: true }));
    expect(loadDriving(false, store)).toMatchObject({ level: 'advanced', ai: true });
  });
  it('toggles off and on, and off it is the level, bit for bit', () => {
    const road = testRoad(), ctx = { free: true, road };
    const a = createDriver('standard', { ai: true }), b = createDriver('standard');
    expect(a.ai).toBe(true); expect(b.ai).toBe(false);
    a.set('standard', { ai: false });
    for (let i = 0; i < 600; i++) {
      const r = raw({ keyAx: (i >> 6) & 1 ? 1 : 0, up: i % 7 < 4 });
      const car = fakeCar((i % 300) / 10, { z: 20 });
      const oa = a.tick(r, car, ctx), ob = b.tick(r, car, ctx);
      expect([oa.steer, oa.throttle, oa.brake]).toEqual([ob.steer, ob.throttle, ob.brake]);
    }
  });
  it('never drives a scored run or the Sandbox: with no road the level drives, bit for bit', () => {
    const a = createDriver('standard', { ai: true }), b = createDriver('standard');
    for (const ctx of [null, { free: true, road: null }]) {
      for (let i = 0; i < 400; i++) {
        const r = raw({ keyAx: (i >> 5) & 1 ? -1 : 0, up: true });
        const car = fakeCar(i / 20);
        const oa = a.tick(r, car, ctx), ob = b.tick(r, car, ctx);
        expect([oa.steer, oa.throttle, oa.brake, oa.ground]).toEqual([ob.steer, ob.throttle, ob.brake, ob.ground]);
        expect(a.aid.ai).toBe(0);
      }
    }
  });
});

describe('the controller (pure)', () => {
  it('writes only the ordinary channels, reuses its output, and a stock car on the ground', () => {
    const road = testRoad(), d = createDriver('advanced', { ai: true, tc: 'off', abs: false });
    const out = { steer: 0, throttle: 0, brake: 0, ground: null };
    const o = d.tick(raw({ up: true, hb: 1 }), fakeCar(10, { z: 20 }), { free: true, road }, out);
    expect(o).toBe(out);
    expect(Object.keys(o).sort()).toEqual(['brake', 'ground', 'steer', 'throttle']);
    // Whatever the level, AI drive drives a stock car with stability control: no spin it could cause.
    expect(o.ground).toMatchObject({ assist: 1, manual: 0, tcOff: false, tcSport: false, absOff: false, handbrake: 0 });
    expect(d.aid.ai).toBe(1);
  });
  it('is deterministic: the same inputs, the same outputs', () => {
    const road = testRoad(), ctx = { free: true, road };
    const a = createDriver('standard', { ai: true }), b = createDriver('standard', { ai: true });
    for (let i = 0; i < 500; i++) {
      const r = raw({ keyAx: [0, 1, -1][i % 3], up: i % 5 > 1, down: i % 17 === 0 });
      const car = fakeCar(5 + (i % 50) / 3, { x: ((i % 13) - 6) * 0.3, z: 10 + i * 0.2 });
      const oa = a.tick(r, car, ctx), ob = b.tick(r, car, ctx);
      expect([oa.steer, oa.throttle, oa.brake]).toEqual([ob.steer, ob.throttle, ob.brake]);
    }
  });
  it('hands off, it brings a car on the verge back onto the road: from the left it steers right (+), from the right left', () => {
    const road = testRoad(), ctx = { free: true, road };
    // +x is the car's left; the road's edge is at ±3.5 m and the assist keeps the car within ±2.2.
    expect(run(createDriver('standard', { ai: true }), raw(), fakeCar(15, { x: 3.4, z: 40 }), ctx, 5).steer).toBeGreaterThan(0.02);
    expect(run(createDriver('standard', { ai: true }), raw(), fakeCar(15, { x: -3.4, z: 40 }), ctx, 5).steer).toBeLessThan(-0.02);
  });
  it('steer moves the target across the road, never past the edge, and a let-go settles in a lane', () => {
    const road = testRoad(), ctx = { free: true, road }, d = createDriver('standard', { ai: true });
    const car = fakeCar(15, { x: -1.68, z: 40 });
    run(d, raw(), car, ctx, 240);
    expect(d.aid.tgt).toBeCloseTo(-1.68, 1);
    run(d, raw({ keyAx: -1 }), car, ctx, 240 * 1.2);   // ← for 1.2 s: across into the left lane
    expect(d.aid.tgt).toBeGreaterThan(0.4);
    run(d, raw(), car, ctx, 240 * 3);
    expect(d.aid.tgt).toBeCloseTo(1.68, 1);              // settled in the left lane
    run(d, raw({ keyAx: 1 }), car, ctx, 240 * 10);      // → held: to the right-hand edge and no further
    expect(d.aid.tgt).toBeCloseTo(-(3.5 - AI.edge - AI.edgeK * (15 - AI.edgeV0)), 6);   // the margin grows with speed
  });
  it('a hard, sustained steer takes the wheel (smoothly), a tap never does', () => {
    const road = testRoad(), ctx = { free: true, road };
    const tap = createDriver('standard', { ai: true });
    run(tap, raw({ keyAx: 1 }), fakeCar(12, { x: -1.68, z: 40 }), ctx, 240 * 0.3);
    expect(tap.aid.take).toBe(0);
    const hard = createDriver('standard', { ai: true });
    const takes = [];
    for (let i = 0; i < 240 * 2; i++) { hard.tick(raw({ keyAx: -1 }), fakeCar(12, { x: 0, z: 40 }), ctx); takes.push(hard.aid.take); }
    expect(takes[240 * 2 - 1]).toBeGreaterThan(0.5);
    for (let i = 1; i < takes.length; i++) expect(Math.abs(takes[i] - takes[i - 1])).toBeLessThan(0.01);   // no jump
  });
  it('GO is the pace: full throttle on a straight, nothing past the safe speed for the bend ahead', () => {
    const road = testRoad(120, 25), ctx = { free: true, road };
    const free = run(createDriver('standard', { ai: true }), raw({ up: true }), fakeCar(10, { x: -1.68, z: 10 }), ctx, 240);
    expect(free.throttle).toBe(1);
    const allow = roadSpeed(road, 50, 1, 30, AI);
    expect(allow).toBeLessThan(25);
    const d = createDriver('standard', { ai: true });
    const o = run(d, raw({ up: true }), fakeCar(30, { x: -1.68, z: 100 }), ctx, 60);
    expect(o.throttle).toBe(0);
    expect(o.brake).toBeGreaterThan(0.3);
    expect(d.aid.allow).toBeLessThan(25);
  });
  it('no GO, no throttle; BRAKE brakes', () => {
    const road = testRoad(), ctx = { free: true, road };
    expect(run(createDriver('standard', { ai: true }), raw(), fakeCar(10, { x: -1.68, z: 20 }), ctx, 240).throttle).toBe(0);
    const b = run(createDriver('standard', { ai: true }), raw({ down: true, up: true }), fakeCar(10, { x: -1.68, z: 20 }), ctx, 240);
    expect(b.brake).toBeGreaterThan(0.9); expect(b.throttle).toBe(0);
  });
  it('allocates nothing per tick', () => {
    const road = testRoad(), ctx = { free: true, road }, d = createDriver('standard', { ai: true });
    const out = { steer: 0, throttle: 0, brake: 0, ground: null }, r = raw({ up: true, keyAx: 1 }), car = fakeCar(20, { z: 30 });
    for (let i = 0; i < 2000; i++) d.tick(r, car, ctx, out);   // warm
    if (!global.gc) return;   // node --expose-gc only
    global.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) d.tick(r, car, ctx, out);
    expect(process.memoryUsage().heapUsed - h0).toBeLessThan(200_000);
  });
});

describe('on the real roads, with any naive input (scripts/drive-feel.mjs diag)', () => {
  // The guarantee: no input a newcomer can give leaves the road or spins the car with AI drive on.
  it('every naive driver, keys and a thumb, on a pass, the coast and the endless road: 0 exits, 0 spins', async () => {
    const bad = [];
    for (const id of ['stelvio', 'atlantic', 'endless']) {
      const road = await loadRoad(id);
      for (const naive of NAIVE) for (const device of naive === 'mash' ? ['keys', 'touch'] : ['keys']) {
        const r = await roadDrive(road, { level: 'standard', ai: true, device, naive, secs: 30, seed: 5 });
        if (r.excursions || r.spins) bad.push(`${id} ${naive} ${device}: exits ${r.excursions} spins ${r.spins}`);
        expect(r.km).toBeGreaterThan(road.endless ? 0.2 : 0.15);   // it drives, it isn't parked
      }
    }
    expect(bad).toEqual([]);
  }, 240_000);
});
