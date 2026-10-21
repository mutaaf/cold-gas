// Free Drive's real roads: the asset loader, the road surface the car drives on, and that a
// scripted drive replays bit-exactly (the sim stays deterministic on these courses too).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRoad, buildRoad, createRoadCourse, roadSurface, poseAt, nearestSample, terrainAt, nearestSeg } from '../../src/sim/roads.js';
import { surface, MATERIALS } from '../../src/sim/courses.js';
import { createVehicle, step, newInput } from '../../src/sim/vehicle.js';
import { quatFromYaw } from '../../src/sim/m3.js';
import { SPEC } from '../../src/sim/spec.js';
import { createPilot } from '../../src/drive/pilot.js';
import { RAPIER } from '../../src/sim/engine.js';
import { GROUP } from '../../src/sim/world.js';
import { ROADS } from '../../src/drive/manifest.js';

const load = (id) => {
  const raw = gunzipSync(readFileSync(new URL(`../../public/roads/${id}.bin.gz`, import.meta.url)));
  return parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
};
const roads = {};
beforeAll(() => { for (const r of ROADS) roads[r.id] = buildRoad(load(r.id)); });

describe('road assets', () => {
  it('ships every road in the manifest, small, with credits', () => {
    expect(ROADS.map((r) => r.id)).toEqual(['stelvio', 'transfagarasan', 'bigsur', 'atlantic']);
    for (const r of ROADS) {
      expect(r.bytes).toBeLessThan(1.5 * 1024 * 1024);
      expect(r.credit.osm).toContain('OpenStreetMap contributors');
      expect(r.credit.dem).toContain('Terrain Tiles');
    }
  });
  it('parses: samples every 3 m, sane widths, elevations and grades', () => {
    for (const r of ROADS) {
      const road = roads[r.id];
      expect(road.meta.spacing).toBe(3);
      expect(road.length / 1000).toBeCloseTo(r.lengthKm, 0);
      for (let i = 0; i < road.n; i++) {
        expect(road.hw[i]).toBeGreaterThan(2.4);
        expect(road.hw[i]).toBeLessThan(7);
        expect(Math.abs(road.bank[i])).toBeLessThanOrEqual(0.07);
      }
      // Built grades (the build holds them to each road's design maximum, ±smoothing).
      for (let i = 0; i < road.m; i++) expect(Math.abs(road.grade[i])).toBeLessThan(0.16);
      expect(Math.abs(road.y[0] - r.startEle)).toBeLessThan(1);
    }
    expect(roads.stelvio.y[roads.stelvio.n - 1]).toBeGreaterThan(2700);    // the pass: 2,757 m
  });
  it('rejects anything that is not a road asset', () => {
    expect(() => parseRoad(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]).buffer)).toThrow(/not a road asset/);
  });
});

describe('road surface', () => {
  const out = {};
  it('is zero on the ribbon, with the grade and banking in its normal', () => {
    for (const r of ROADS) {
      const road = roads[r.id];
      for (let s = 30; s < road.length - 30; s += 97) {
        const p = poseAt(road, s, 1);
        if (road.flags[p.i] & 2) continue;                  // tunnels have a roof
        expect(Math.abs(roadSurface(road, p.x, p.y, p.z, out))).toBeLessThan(0.02);
        expect(out.mat).toBe(MATERIALS.asphalt);
        // Half a metre up, the distance is half a metre along the normal.
        const d = roadSurface(road, p.x, p.y + 0.5, p.z, out);
        expect(d).toBeCloseTo(0.5 * out.y, 1);
        expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
        // The normal leans back against the grade: n · t = −g / √(1 + g² + b²).
        const i = p.i, g = road.grade[i];
        const nt = out.x * road.dx[i] + out.z * road.dz[i];
        expect(nt).toBeCloseTo(-g * out.y, 1);
      }
    }
  });
  it('the courses’ surface() hands a road course to it unchanged', () => {
    const road = roads.stelvio, course = createRoadCourse(road), p = poseAt(road, 500, 1), a = {}, b = {};
    expect(surface(course, p.x, p.y + 1, p.z, a)).toBe(roadSurface(road, p.x, p.y + 1, p.z, b));
  });
  it('steps down smoothly off the edge onto the shoulder and the verge', () => {
    const road = roads.transfagarasan;
    for (let s = 200; s < road.length - 200; s += 211) {
      const p = poseAt(road, s, 1), i = p.i;
      if (road.flags[i] & 3) continue;
      const lx = road.dz[i], lz = -road.dx[i];
      let prev = null;
      for (let lat = 0; lat < road.hw[i] + 4; lat += 0.1) {
        const x = road.x[i] + lx * lat, z = road.z[i] + lz * lat;
        // Height of the ground under this point, from a probe 2 m above.
        const top = road.y[i] + 3;
        const h = top - roadSurface(road, x, top, z, out) / Math.max(0.3, out.y);
        if (prev !== null && !(road.flags[i] & 0x3c)) expect(Math.abs(h - prev)).toBeLessThan(0.2);
        prev = h;
      }
    }
  });
  it('walls and rails are solid obstacles beside the road', () => {
    const road = roads.stelvio;
    let found = 0;
    for (let i = 10; i < road.m && found < 5; i++) {
      const wall = (k) => ((road.flags[k] >> 2) & 3) === 2 && !(road.flags[k] & 3);
      if (!wall(i - 1) || !wall(i) || !wall(i + 1)) continue;
      const lx = road.dz[i], lz = -road.dx[i], c = road.hw[i] + 0.3 + 0.25;
      const x = road.x[i] + lx * c, z = road.z[i] + lz * c, y = road.y[i] + road.bank[i] * road.hw[i] + 0.3;
      expect(roadSurface(road, x, y, z, out)).toBeLessThan(0);
      expect(out.obstacle).toBe(true);
      found++;
    }
    expect(found).toBe(5);
  });
  it('the terrain meets the road: conformed under the shoulders, DEM far away', () => {
    const road = roads.stelvio, t = [0, 0, 0], q = {};
    const p = poseAt(road, 3000, 1);
    expect(nearestSeg(road, p.x, p.y, p.z, q)).toBe(true);
    expect(Math.abs(terrainAt(road, p.x, p.z, t)[0] - p.y)).toBeLessThan(0.6);
    const far = terrainAt(road, road.bounds.minX - 800, road.bounds.minZ - 800, t)[0];
    expect(far).toBeGreaterThan(500);
    expect(far).toBeLessThan(4000);
  });
});

describe('driving a real road', () => {
  function drive(id, ticks) {
    const road = roads[id], car = createVehicle(createRoadCourse(road)), p = poseAt(road, 30, 1);
    car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
    quatFromYaw(car.quat, p.yaw);
    const pilot = createPilot(road, { vmax: 22 });
    for (let t = 0; t < ticks; t++) step(car, pilot(car));
    return { car, road };
  }
  it('sits on the road and drives up it under the pilot', () => {
    const { car, road } = drive('stelvio', 240 * 25);
    const i = nearestSample(road, car.pos.x, car.pos.z);
    expect(i * road.meta.spacing).toBeGreaterThan(250);
    expect(car.grounded).toBeGreaterThanOrEqual(3);
    expect(Math.abs(car.pos.y - SPEC.comHeight - road.y[i])).toBeLessThan(0.6);
  });
  it('replays bit-exactly', () => {
    const a = drive('atlantic', 240 * 8).car, b = drive('atlantic', 240 * 8).car;
    for (const k of ['x', 'y', 'z']) { expect(a.pos[k]).toBe(b.pos[k]); expect(a.vel[k]).toBe(b.vel[k]); }
    for (const k of ['x', 'y', 'z', 'w']) expect(a.quat[k]).toBe(b.quat[k]);
  });
  it('the engine\'s near-car copy of the road (what the hull hits) lies on the road', () => {
    const { car } = drive('stelvio', 240 * 4);
    const w = car.world, out = {};
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    let sum = 0, n = 0;
    for (let dx = -40; dx <= 40; dx += 3.7) for (let dz = -40; dz <= 40; dz += 3.3) {
      const x = car.pos.x + dx, z = car.pos.z + dz;
      ray.origin.x = x - w.ox; ray.origin.y = car.pos.y + 1.4 - w.oy; ray.origin.z = z - w.oz;
      const h = w.rw.castRay(ray, 200, true, undefined, ((0xffff << 16) | GROUP.approx) >>> 0);
      if (!h) continue;
      const phi = w.course.sdf(x, car.pos.y + 1.4 - h.timeOfImpact, z, out);
      if (out.y > 0.7) { sum += Math.abs(phi); n++; }
    }
    expect(n).toBeGreaterThan(100);
    expect(sum / n).toBeLessThan(0.05);   // 2 m posts on the exact surface: centimetres between them
  });
  it('src/sim/roads.js keeps to deterministic math', () => {
    const src = readFileSync(new URL('../../src/sim/roads.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|pow|exp|log|random)\b/);
    expect(src).not.toMatch(/Date\.now|performance\.now/);
  });
  it('a stunt input on a road world is the same vehicle code (no special cases)', () => {
    const road = roads.bigsur, car = createVehicle(createRoadCourse(road)), p = poseAt(road, 100, 1);
    car.pos.x = p.x; car.pos.y = p.y + 1.5; car.pos.z = p.z;
    quatFromYaw(car.quat, p.yaw);
    for (let t = 0; t < 240 * 3; t++) step(car, newInput());
    expect(car.grounded).toBe(4);
  });
});

// Off the road and back on (the bug: "the car can't get back on the track from grass"). The ground
// beside the road was the natural mountainside and the structural 1:1.5 fill / 1:1 cut right up to
// the shoulder, and traction control's torque floor was more than a tyre could carry on grass.
describe('back on the road from the grass', () => {
  const sn = {};
  const groundY = (road, x, z, y0) => {
    let lo = y0 - 120, hi = y0 + 120;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (roadSurface(road, x, m, z, sn) > 0) hi = m; else lo = m; }
    roadSurface(road, x, hi + 0.01, z, sn);
    return hi;
  };
  // The car sitting on ground of normal n with its nose along (tx, tz): body +x left, +y up, +z fwd.
  const settle = (q, tx, tz, n) => {
    const d = tx * n.x + tz * n.z;
    let fx = tx - n.x * d, fy = -n.y * d, fz = tz - n.z * d;
    const l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
    const lx = n.y * fz - n.z * fy, ly = n.z * fx - n.x * fz, lz = n.x * fy - n.y * fx;
    const S = Math.sqrt(lx + n.y + fz + 1) * 2;             // upright enough that the trace is > 0
    q.w = 0.25 * S; q.x = (n.z - fy) / S; q.y = (fx - lz) / S; q.z = (ly - n.x) / S;
  };
  // A driver on the verge, `off` m past the edge, facing back at the road `ang`° off square, full
  // throttle, steering at the road 12 m on. Back on = on the ribbon with 3+ wheels down.
  function tryBack(road, s, side, off, ang) {
    const p = poseAt(road, s, 1), i = p.i;
    const lx = road.dz[i], lz = -road.dx[i], lat = side * (road.hw[i] + off);
    const x = road.x[i] + lx * lat, z = road.z[i] + lz * lat, gy = groundY(road, x, z, road.y[i]);
    if (sn.y < 0.6) return null;                                    // a cliff or a cut face: not a verge
    const car = createVehicle(createRoadCourse(road));
    car.pos.x = x; car.pos.y = gy + SPEC.comHeight + 0.15; car.pos.z = z;
    const a = (ang * Math.PI) / 180, tx = road.dx[i] * Math.sin(a) - lx * side * Math.cos(a), tz = road.dz[i] * Math.sin(a) - lz * side * Math.cos(a);
    settle(car.quat, tx, tz, { x: sn.x, y: sn.y, z: sn.z });
    const hold = newInput(); hold.brake = 1;
    for (let t = 0; t < 240; t++) step(car, hold);
    const inp = newInput(); inp.throttle = 1;
    const q = { seg: -1, t: 0, lat: 99, yc: 0, hw: 0, bank: 0, u: 0 };
    for (let t = 0; t < 240 * 8; t++) {
      if (nearestSeg(road, car.pos.x, car.pos.y, car.pos.z, q)) {
        if (Math.abs(q.lat) < q.hw && car.grounded >= 3) return true;
        const j = Math.min(road.m - 1, q.seg + 4), c = car.quat;
        const fx = 2 * (c.x * c.z + c.w * c.y), fz = 1 - 2 * (c.x * c.x + c.y * c.y);
        const ex = road.x[j] - car.pos.x, ez = road.z[j] - car.pos.z;
        inp.steer = Math.max(-1, Math.min(1, Math.atan2(-(ex * fz - ez * fx), ex * fx + ez * fz) * 2));
      }
      step(car, inp);
    }
    return false;
  }
  for (const id of ['stelvio', 'transfagarasan', 'bigsur', 'atlantic']) {
    it(`${id}: drives back on from the verge at 4 m and 8 m, both sides, all along it`, () => {
      const road = roads[id], res = { 4: [0, 0], 8: [0, 0] };
      for (let s = 180; s < road.length - 180; s += 577) for (const side of [1, -1]) {
        const i = poseAt(road, s, 1).i;
        if (road.flags[i] & 3 || (side > 0 ? (road.flags[i] >> 2) & 3 : (road.flags[i] >> 4) & 3)) continue;   // bridges, tunnels, rails
        for (const [off, ang] of [[4, 30], [8, 40]]) {
          const ok = tryBack(road, s, side, off, ang);
          if (ok === null) continue;
          res[off][1]++; if (ok) res[off][0]++;
        }
      }
      // Before the fix: 4 m 61–73 %, 8 m 56–80 %. On the passes, 8 m out is the apron's edge, and the
      // mountainside past it is often more than a car can climb (that's what R is for).
      expect(res[4][1]).toBeGreaterThan(8);
      expect(res[4][0] / res[4][1]).toBeGreaterThanOrEqual(0.9);
      expect(res[8][0] / res[8][1]).toBeGreaterThanOrEqual({ stelvio: 0.7, transfagarasan: 0.75 }[id] ?? 0.9);
    }, 60_000);
  }
  it('the roadside is a graded 1:4 apron: no steeper and no steps, 7 m past the shoulder', () => {
    for (const id of ['bigsur', 'atlantic', 'transfagarasan']) {
      const road = roads[id];
      for (let s = 150; s < road.length - 150; s += 389) for (const side of [1, -1]) {
        const i = Math.floor(s / 3);
        if (road.flags[i] & 0x3f || road.flags[i + 1] & 0x3f) continue;
        const lx = road.dz[i], lz = -road.dx[i], hw = road.hw[i];
        const q = { seg: -1, lat: 0, other: Infinity };
        let prev = null;
        for (let e = 1.3; e < 8.1; e += 0.1) {
          const x = road.x[i] + lx * side * (hw + e), z = road.z[i] + lz * side * (hw + e), y = groundY(road, x, z, road.y[i]);
          nearestSeg(road, x, y + 0.5, z, q);
          if (q.other - Math.abs(q.lat) < 6) { prev = null; continue; }         // another leg near: the blend
          if (prev !== null) expect(Math.abs(y - prev)).toBeLessThan(0.1 * 0.27 + 0.004);
          prev = y;
        }
      }
    }
  });
});

describe('traction control on loose ground', () => {
  const plane = (slope, mat) => {
    const k = 1 / Math.sqrt(1 + slope * slope);
    // 100 m up: a course without a road gets a flat floor at y = 0 in the rigid-body engine.
    return { id: 'plane', boxes: [], start: { x: 0, z: 0 }, runout: {}, sdf: (x, y, z, out) => { out.x = 0; out.y = k; out.z = -slope * k; out.mat = mat; out.obstacle = false; out.body = null; return (y - 100 - slope * z) * k; } };
  };
  it('climbs a 1:4 grass bank at full throttle (it slid back down an 11 % one)', () => {
    for (const slope of [0.2, 0.25]) {
      const car = createVehicle(plane(slope, MATERIALS.grass));
      car.pos.x = 0; car.pos.z = 0; car.pos.y = 100 + SPEC.comHeight + 0.05;
      const a = -Math.atan(slope) / 2; car.quat.x = Math.sin(a); car.quat.y = 0; car.quat.z = 0; car.quat.w = Math.cos(a);
      const hold = newInput(); hold.brake = 1;
      for (let t = 0; t < 240; t++) step(car, hold);
      const inp = newInput(); inp.throttle = 1;
      for (let t = 0; t < 240 * 4; t++) step(car, inp);
      expect(car.pos.z).toBeGreaterThan(3);
      expect(car.vel.z).toBeGreaterThan(1.5);
    }
  });
  it('the stunt courses never touch loose ground, so their runs are unchanged', () => {
    for (const m of ['concrete', 'paint', 'asphalt', 'barrier']) expect(MATERIALS[m].loose).toBeUndefined();
  });
});
