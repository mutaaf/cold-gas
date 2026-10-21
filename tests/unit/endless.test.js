// The endless road: a world that is a pure function of its seed (land, road, ground under every
// point), tiles that meet without seams, a road surface without steps, a car that drives it and
// gets back on it from the grass, and the world API's placed objects.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEndlessRoad, createEndlessCourse, createTerrain, ENDLESS_VERSION } from '../../src/sim/endless.js';
import { createObjects, objectId } from '../../src/sim/objects.js';
import { roadSurface, poseAt, nearestSeg, groundAt } from '../../src/sim/roads.js';
import { seedOf } from '../../src/sim/noise.js';
import { createVehicle, step, newInput } from '../../src/sim/vehicle.js';
import { quatFromYaw } from '../../src/sim/m3.js';
import { SPEC } from '../../src/sim/spec.js';
import { createPilot } from '../../src/drive/pilot.js';
import { createTileGen, buildTile, LEVELS, N } from '../../src/world/tilegen.js';

const KEYS = ['x', 'z', 'y', 'hw', 'bank', 'sx', 'sz', 'dx', 'dz', 'len', 'grade', 'vnx', 'vnz'];

describe('the endless world is its seed', () => {
  it('the same seed builds the same road, bit for bit; another seed another road', () => {
    const a = createEndlessRoad('cold-gas').generate(4000), b = createEndlessRoad('cold-gas').generate(4000), c = createEndlessRoad('cold-gaz').generate(4000);
    for (const k of KEYS) for (let i = 0; i < 3990; i++) expect(a[k][i]).toBe(b[k][i]);
    for (let i = 0; i < 3990; i++) expect(a.flags[i]).toBe(b.flags[i]);
    let same = 0;
    for (let i = 100; i < 3990; i += 50) if (a.x[i] === c.x[i]) same++;
    expect(same).toBeLessThan(3);
    expect(seedOf('cold-gas')).toBe(seedOf('cold-gas'));
    expect(ENDLESS_VERSION).toBeGreaterThan(0);
  }, 60_000);
  it('the ground at a point does not depend on when or how far the road was generated', () => {
    const lazy = createEndlessCourse(42), eager = createEndlessCourse(42);
    eager.road.generate(9000);
    const o1 = {}, o2 = {};
    for (let k = 0; k < 400; k++) {
      const i = 100 + k * 17, r = eager.road;
      const x = r.x[i] + ((k % 9) - 4) * 3.3, z = r.z[i] + ((k % 5) - 2) * 2.1, y = r.y[i] + 0.3 + (k % 3);
      expect(lazy.sdf(x, y, z, o1)).toBe(eager.sdf(x, y, z, o2));
      expect([o1.x, o1.y, o1.z, o1.mat.id]).toEqual([o2.x, o2.y, o2.z, o2.mat.id]);
    }
  }, 60_000);
  it('heads north forever: z grows along it, within the design grade and curvature', () => {
    const r = createEndlessRoad('north').generate(12000);
    for (let i = 1; i < r.n; i++) expect(r.z[i]).toBeGreaterThan(r.z[i - 1]);
    for (let i = 0; i < r.m; i++) expect(Math.abs(r.grade[i])).toBeLessThan(0.105);
    for (let i = 2; i < r.m - 2; i++) {
      const cr = Math.abs(r.dx[i - 1] * r.dz[i + 1] - r.dz[i - 1] * r.dx[i + 1]);
      expect(6 / Math.max(cr, 1e-9)).toBeGreaterThan(40);        // radius > 40 m everywhere
    }
  }, 60_000);
  it('passes through all four lands within a long drive, and keeps out of the sea', () => {
    const seen = new Set(), h = [0, 0, 0];
    for (const s of ['cold-gas', 7, 'alpha']) {
      const r = createEndlessRoad(s).generate(30000);
      for (let i = 0; i < r.n; i += 10) seen.add(r.biome[i]);
      for (let i = 0; i < r.n; i += 10) expect(r.y[i]).toBeGreaterThan(2.9);
      // Over the water the road is a bridge.
      for (let i = 0; i < r.m; i += 7) if (r.dem(r.x[i], r.z[i], h)[0] < 0) expect(r.flags[i] & 1).toBe(1);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  }, 60_000);
  it('the terrain gradient is the height’s true slope (the physics reads normals from it)', () => {
    const t = createTerrain('slope'), o = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
    for (let k = 0; k < 200; k++) {
      const x = -4000 + k * 97.3, z = k * 311.7, e = 0.01;
      t.heightAt(x, z, o);
      const gx = (t.heightAt(x + e, z, a)[0] - t.heightAt(x - e, z, b)[0]) / (2 * e);
      const gz = (t.heightAt(x, z + e, a)[0] - t.heightAt(x, z - e, b)[0]) / (2 * e);
      expect(o[1]).toBeCloseTo(gx, 3);
      expect(o[2]).toBeCloseTo(gz, 3);
    }
  }, 60_000);
  it('src/sim keeps to deterministic math here too', () => {
    for (const f of ['endless.js', 'noise.js', 'objects.js']) {
      const src = readFileSync(new URL(`../../src/sim/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|pow|exp|log|random)\b|\*\*/);
      expect(src).not.toMatch(/Date\.now|performance\.now/);
    }
  }, 60_000);
});

describe('tiles and seams', () => {
  const gen = createTileGen('seams');
  gen.road.generate(3000);
  const at = (t, a, b) => t.pos[(b * (N + 1) + a) * 3 + 1];
  it('neighbouring tiles share their edge exactly, at every level', () => {
    const r = gen.road, x = r.x[600], z = r.z[600];
    for (let lvl = 0; lvl < 3; lvl++) {
      const size = LEVELS[lvl].size, i = Math.floor(x / size), j = Math.floor(z / size);
      const t = buildTile(gen, lvl, i, j), e = buildTile(gen, lvl, i + 1, j), s = buildTile(gen, lvl, i, j + 1);
      for (let k = 0; k <= N; k++) {
        expect(at(t, N, k)).toBe(at(e, 0, k));
        expect(at(t, k, N)).toBe(at(s, k, 0));
      }
    }
  }, 60_000);
  it('a vertex sits on the ground the car feels (away from the road corridor)', () => {
    const r = gen.road, x = r.x[900] + 200, z = r.z[900];
    const t = buildTile(gen, 0, Math.floor(x / 128), Math.floor(z / 128)), q = { seg: -1, lat: 0, hw: 0 }, g = [0, 0, 0];
    let checked = 0;
    for (let b = 0; b <= N; b += 4) for (let a = 0; a <= N; a += 4) {
      const vx = t.x0 + a * 4, vz = t.z0 + b * 4, y = at(t, a, b);
      if (nearestSeg(r, vx, y, vz, q) && Math.abs(q.lat) - q.hw < 14) continue;
      expect(Math.abs(y - Math.max(0, groundAt(r, vx, y, vz, g)[0]))).toBeLessThan(1e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000);
  it('vegetation is deterministic and stays off the road', () => {
    const r = gen.road, x = r.x[1200], z = r.z[1200], i = Math.floor(x / 128), j = Math.floor(z / 128);
    const veg = { conifer: 8, broad: 10, shrub: 8, rock: 9 };
    const a = buildTile(gen, 0, i, j, { veg }), b = buildTile(gen, 0, i, j, { veg });
    const q = { seg: -1, lat: 0, hw: 0 };
    for (const [k, v] of Object.entries(a.veg)) {
      expect(Array.from(v.m)).toEqual(Array.from(b.veg[k].m));
      for (let n = 0; n < v.n; n++) {
        const px = a.x0 + v.m[n * 16 + 12], pz = a.z0 + v.m[n * 16 + 14], py = v.m[n * 16 + 13];
        if (nearestSeg(r, px, py, pz, q)) expect(Math.abs(q.lat) - q.hw).toBeGreaterThan(4);
      }
    }
  }, 60_000);
});

describe('the road surface', () => {
  it('is continuous along the road and across the generator’s publish boundaries', () => {
    const r = createEndlessRoad('surface').generate(2200), o = {};
    for (const lat of [-1.8, 0, 1.6]) {
      let prev = null;
      for (let s = 30; s < 6200; s += 0.25) {
        const p = poseAt(r, s, 1);
        const i = p.i, lx = r.dz[i], lz = -r.dx[i];
        const x = p.x + lx * (lat + 1.9), z = p.z + lz * (lat + 1.9);
        // The surface height there, by bisection on the distance's sign (a rail beside the road is
        // nearer than the road to a probe above it, so phi alone isn't a height).
        let lo = p.y - 2, hi = p.y + 2;
        for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (roadSurface(r, x, m, z, o) > 0) hi = m; else lo = m; }
        const y = hi;
        if (prev !== null) expect(Math.abs(y - prev)).toBeLessThan(0.04);
        prev = y;
      }
    }
  }, 60_000);
  it('a car drives it under the pilot, on the road, and replays bit-exactly', () => {
    const run = () => {
      const course = createEndlessCourse('drive'), road = course.road, car = createVehicle(course), p = poseAt(road, 60, 1);
      car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
      quatFromYaw(car.quat, p.yaw);
      const pilot = createPilot(road, { vmax: 30 }), q = { seg: -1, lat: 0, hw: 0 };
      let maxLat = -Infinity;
      for (let t = 0; t < 240 * 30; t++) {
        step(car, pilot(car));
        if (t % 60 === 0 && nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) maxLat = Math.max(maxLat, Math.abs(q.lat) - q.hw);
      }
      return { car, road, maxLat, q };
    };
    const a = run(), b = run();
    expect(a.q.seg * 3).toBeGreaterThan(500);
    expect(a.maxLat).toBeLessThan(0);
    expect(a.car.grounded).toBeGreaterThanOrEqual(3);
    for (const k of ['x', 'y', 'z']) expect(a.car.pos[k]).toBe(b.car.pos[k]);
  }, 60_000);
  it('back on from the grass: 4 m and 8 m off, both sides, all along it', () => {
    const course = createEndlessCourse('verge'), road = course.road;
    road.generate(5000);
    const sn = {}, res = [0, 0];
    for (let s = 300; s < 14000; s += 700) for (const side of [1, -1]) for (const off of [4, 8]) {
      const p = poseAt(road, s, 1), i = p.i;
      if (road.flags[i] & 0x3f) continue;
      const lx = road.dz[i], lz = -road.dx[i], x = road.x[i] + lx * side * (road.hw[i] + off), z = road.z[i] + lz * side * (road.hw[i] + off);
      let lo = road.y[i] - 80, hi = road.y[i] + 80;
      for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (roadSurface(road, x, m, z, sn) > 0) hi = m; else lo = m; }
      roadSurface(road, x, hi + 0.01, z, sn);
      if (sn.y < 0.6) continue;
      const car = createVehicle(course);
      car.pos.x = x; car.pos.y = hi + SPEC.comHeight + 0.2; car.pos.z = z;
      quatFromYaw(car.quat, Math.atan2(road.dx[i] * 0.5 - lx * side * 0.87, road.dz[i] * 0.5 - lz * side * 0.87));
      const hold = newInput(); hold.brake = 1;
      for (let t = 0; t < 240; t++) step(car, hold);
      const inp = newInput(); inp.throttle = 1;
      const q = { seg: -1, lat: 99, hw: 0 };
      let back = false;
      for (let t = 0; t < 240 * 8 && !back; t++) {
        if (nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) {
          if (Math.abs(q.lat) < q.hw && car.grounded >= 3) back = true;
          const j = Math.min(road.m - 1, q.seg + 4), c = car.quat, fx = 2 * (c.x * c.z + c.w * c.y), fz = 1 - 2 * (c.x * c.x + c.y * c.y);
          const ex = road.x[j] - car.pos.x, ez = road.z[j] - car.pos.z;
          inp.steer = Math.max(-1, Math.min(1, Math.atan2(-(ex * fz - ez * fx), ex * fx + ez * fz) * 2));
        }
        step(car, inp);
      }
      res[1]++; if (back) res[0]++;
    }
    expect(res[1]).toBeGreaterThan(20);
    expect(res[0] / res[1]).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});

describe('the world API: placed objects', () => {
  it('ids come from what and where, and are the same every time', () => {
    const a = createObjects({ seed: 9 }), b = createObjects({ seed: 9 });
    const spec = { type: 'ramp', x: 120.5, y: 3, z: 880.25, yaw: 0.3 };
    const ia = a.add(spec), ib = b.add({ ...spec });
    expect(ia).toBe(ib);
    expect(ia).toMatch(/^ramp\.1\.13\.[0-9a-z]{6}$/);
    expect(a.add(spec)).toBe(`${ia}~2`);                 // the same thing twice gets a second id
    expect(objectId(9, { ...spec, x: 121 })).not.toBe(ia);
    expect(a.near(120, 880, 10).map((o) => o.id)).toEqual([ia, `${ia}~2`]);
    expect(a.remove(ia)).toBe(true);
    expect(a.count).toBe(1);
    const json = a.toJSON(), c = createObjects({ seed: 9 });
    c.load(json);
    expect(c.toJSON()).toEqual(json);
  }, 60_000);
  it('a ramp is solid to the car: it drives up it and leaves the top airborne', () => {
    const course = createEndlessCourse('ramp'), road = course.road;
    course.objects = createObjects({ seed: road.seed });
    const p = poseAt(road, 400, 1);
    // Find a straight, flat stretch: put the ramp 40 m ahead of the car in its lane.
    const ahead = poseAt(road, 440, 1);
    course.objects.add({ type: 'ramp', x: ahead.x, y: ahead.y, z: ahead.z, yaw: ahead.yaw, w: 4, l: 8, h: 1.2 });
    const car = createVehicle(course);
    car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
    quatFromYaw(car.quat, p.yaw);
    const inp = newInput(); inp.throttle = 0.7;
    let maxY = -Infinity, air = 0, hitObj = false;
    const out = {};
    for (let t = 0; t < 240 * 6; t++) {
      step(car, inp);
      const ground = roadSurface(road, car.pos.x, car.pos.y, car.pos.z, out);
      maxY = Math.max(maxY, car.pos.y - (car.pos.y - ground));
      if (course.sdf(car.pos.x, car.pos.y - 0.4, car.pos.z, out) < 0.2 && out.object) hitObj = true;
      if (car.grounded === 0) air++;
    }
    expect(hitObj).toBe(true);
    expect(air).toBeGreaterThan(20);                      // it left the lip
  }, 60_000);
  it('a loop’s riding face is its inside, and boost pads are triggers, not solids', () => {
    const o = createObjects({ seed: 1 }), out = {};
    o.add({ type: 'loop', x: 0, y: 0, z: 0, yaw: 0, r: 6, w: 4 });
    o.add({ type: 'boost', x: 30, y: 0, z: 0, yaw: 0 });
    // Inside the loop at its top, the face is above: the normal points down.
    const d = o.sdf(0.5 * 4.6 * 0.5, 11.5, 0, out);
    expect(d).toBeGreaterThan(0.3); expect(d).toBeLessThan(0.7);
    expect(out.y).toBeLessThan(-0.9);
    // At its foot it's ground: the normal points up.
    expect(o.sdf(0.2, 0.3, 0.1, out)).toBeCloseTo(0.3, 1);
    expect(out.y).toBeGreaterThan(0.9);
    expect(o.sdf(30, 0.5, 0, out)).toBeGreaterThan(20);           // only the loop, far off
    expect(o.triggersAt(30, 0.5, 0).map((t) => t.type)).toEqual(['boost']);
    expect(o.colliders().map((c) => c.shape)).toEqual(['loop']);
  }, 60_000);
});
