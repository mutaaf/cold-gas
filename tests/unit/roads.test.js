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
