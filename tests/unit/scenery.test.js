// What you see is what you hit (Free Drive, the endless world, the Sandbox): the trees, boulders,
// brush, ground, structures and build pieces the renderer draws are the solids the car meets, from
// the same placement and the same numbers, and nothing the car can meet is undrawn.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRoad, buildRoad, createRoadCourse, terrainAt, groundAt, poseAt, nearestSeg, roadSurface, RAILS } from '../../src/sim/roads.js';
import { createEndlessCourse } from '../../src/sim/endless.js';
import { bakedTrees, endlessProps, VEG_SPACING, SHAPES, CELL, rockPoints } from '../../src/sim/scenery.js';
import { MATERIALS } from '../../src/sim/courses.js';
import { createVehicle, step, newInput } from '../../src/sim/vehicle.js';
import { surfaceHeight, GROUP } from '../../src/sim/world.js';
import { RAPIER } from '../../src/sim/engine.js';
import { SPEC } from '../../src/sim/spec.js';
import { createArenaCourse, MASTS } from '../../src/build/arena.js';
import { createObjectStore, composeCourse } from '../../src/build/objects.js';
import { createObjects } from '../../src/sim/objects.js';

const load = (id) => {
  const raw = gunzipSync(readFileSync(new URL(`../../public/roads/${id}.bin.gz`, import.meta.url)));
  return buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
};
const roads = {};
beforeAll(() => { for (const id of ['stelvio', 'bigsur', 'atlantic']) roads[id] = load(id); });

const so = { x: 0, y: 1, z: 0 };
const ground = (course, x, z, y0) => { const y = surfaceHeight(course.sdf, x, z, y0 + 3); course.sdf(x, y + 0.01, z, so); return { y, ny: so.y, mat: so.mat }; };
// Put the car `back` m short of (x, z), facing it, on the ground, at `speed`; hold a little throttle.
function ram(course, x, z, yHint, { back = 12, speed = 14, secs = 2.5, dir = { x: 0, z: 1 } } = {}) {
  const sx = x - dir.x * back, sz = z - dir.z * back, g = ground(course, sx, sz, yHint);
  const car = createVehicle(course);
  car.pos.x = sx; car.pos.y = g.y + SPEC.comHeight + 0.1; car.pos.z = sz;
  const yaw = Math.atan2(dir.x, dir.z);
  car.quat.x = 0; car.quat.y = Math.sin(yaw / 2); car.quat.z = 0; car.quat.w = Math.cos(yaw / 2);
  car.vel.x = dir.x * speed; car.vel.z = dir.z * speed;
  for (const w of car.wheels) w.omega = speed / 0.35;
  const inp = newInput(); inp.throttle = 0.35;
  let past = -Infinity, hull = 0, minD = Infinity, vMin = Infinity;
  for (let t = 0; t < 240 * secs; t++) {
    step(car, inp);
    if (car.hullContact) hull++;
    vMin = Math.min(vMin, Math.hypot(car.vel.x, car.vel.z));
    const ex = car.pos.x - x, ez = car.pos.z - z;
    if (Math.abs(ex * dir.z - ez * dir.x) < 1.5) past = Math.max(past, ex * dir.x + ez * dir.z);
    minD = Math.min(minD, Math.hypot(ex, ez));
  }
  return { car, past, hull, minD, vMin, v: Math.hypot(car.vel.x, car.vel.z) };
}
// A prop with open, gentle ground on its −z side and nothing else in the lane.
function openProp(course, list, test) {
  for (const p of list) {
    if (!test(p)) continue;
    const a = ground(course, p.x, p.z - 12, p.y), b = ground(course, p.x, p.z - 5, p.y);
    if (a.ny < 0.92 || b.ny < 0.92 || Math.abs(a.y - p.y) > 2) continue;
    if (list.some((o) => o !== p && Math.abs(o.x - p.x) < 2.6 && o.z < p.z && o.z > p.z - 15)) continue;
    return p;
  }
  return null;
}
// Every collider in a car's world: { kind, x, y, z, group, mat, shape }.
function colliders(w) {
  const out = [];
  w.rw.forEachCollider((c) => {
    const info = w.info.get(c.handle);
    if (!info || info.car) return;
    const t = c.translation();
    out.push({ x: t.x + w.ox, y: t.y + w.oy, z: t.z + w.oz, approx: info.approx, mat: info.mat, shape: c.shape.type, col: c });
  });
  return out;
}

describe('trees are solid', () => {
  it('a baked road\'s trees: driven at at 50 km/h, the car stops at the trunk (it drove through them)', () => {
    for (const id of ['stelvio', 'bigsur']) {
      const road = roads[id], course = createRoadCourse(road);
      let tried = 0;
      for (let s = 600; s < road.length - 600 && tried < 3; s += 397) {
        const p0 = poseAt(road, s, 1);
        const trees = bakedTrees(road, Math.floor(p0.x / 128) * 128, Math.floor(p0.z / 128) * 128);
        const t = openProp(course, trees, (q) => SHAPES[q.type].trunkR * q.sx > 0.3);
        if (!t) continue;
        const r = ram(course, t.x, t.z, t.y), rt = SHAPES[t.type].trunkR * t.sx;
        expect(r.past).toBeLessThan(-1.5);            // the nose (≈ 2.4 m ahead of the centre) at the bark
        expect(r.minD).toBeGreaterThan(rt + 0.9);     // the body never in the trunk (half-width 0.96 m)
        // From 14 m/s and a held throttle the strike costs at least a quarter of it: dead on it stops
        // the car; a hair off centre the round bark turns it aside (−35 %) and it drives on.
        expect(r.vMin).toBeLessThan(10.5);
        expect(r.hull).toBeGreaterThan(0);
        tried++;
      }
      expect(tried).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);
  it('the endless world\'s trees and big boulders stop it too; its brush only slows it', () => {
    const course = createEndlessCourse('forest'), road = course.road;
    road.ensure(6000);
    const found = { tree: 0, shrub: 0 };
    for (let k = 300; k < 1800 && (found.tree < 2 || found.shrub < 1); k += 53) {
      const x0 = Math.floor(road.x[k] / 128) * 128, z0 = Math.floor(road.z[k] / 128) * 128;
      const all = endlessProps(road, 0, x0, z0, 128, VEG_SPACING), list = Object.values(all).flat();
      if (found.tree < 2) {
        const t = openProp(course, list, (q) => (q.type === 'conifer' || q.type === 'broad') && SHAPES[q.type].trunkR * q.sx > 0.3);
        if (t) { const r = ram(course, t.x, t.z, t.y); expect(r.past).toBeLessThan(-1.5); expect(r.minD).toBeGreaterThan(SHAPES[t.type].trunkR * t.sx + 0.9); expect(r.hull).toBeGreaterThan(0); found.tree++; }
      }
      if (found.shrub < 1) {
        const b = openProp(course, list, (q) => q.type === 'shrub' && q.sy > 1.5);
        if (b) {
          // Through brush: slower than past it on the same ground, but through.
          const r = ram(course, b.x, b.z, b.y, { secs: 1.6 }), free = ram(course, b.x + 30, b.z, b.y, { secs: 1.6 });
          const g = ground(course, b.x + 30, b.z, b.y), g2 = ground(course, b.x + 30, b.z - 12, b.y);
          if (g.ny > 0.92 && g2.ny > 0.92 && Math.abs(g.y - b.y) < 2) {
            expect(r.past).toBeGreaterThan(5);
            expect(r.v).toBeLessThan(free.v);
            found.shrub++;
          }
        }
      }
    }
    expect(found.tree).toBe(2);
  }, 120_000);
});

describe('the ground is the ground that is drawn', () => {
  it('a baked road\'s land is exactly the renderer\'s 4 m triangle mesh (a bilinear patch stood up to 2 m off it)', () => {
    const road = roads.bigsur, t3 = [0, 0, 0];
    const post = (x, z) => terrainAt(road, x, z, t3)[0];
    let worst = 0;
    for (let k = 0; k < 4000; k++) {
      const i = (k * 7919) % road.n, x = road.x[i] + ((k * 37) % 200) - 100 + 0.37, z = road.z[i] + ((k * 53) % 200) - 100 + 0.61;
      const cx = Math.floor(x / 4) * 4, cz = Math.floor(z / 4) * 4, u = (x - cx) / 4, v = (z - cz) / 4;
      // The renderer splits each cell from its (+x, z) corner to its (x, +z) corner (src/render/road.js makeTile).
      const h10 = post(cx + 4, cz), h01 = post(cx, cz + 4);
      const tri = u + v <= 1 ? post(cx, cz) * (1 - u - v) + h10 * u + h01 * v : post(cx + 4, cz + 4) * (u + v - 1) + h01 * (1 - u) + h10 * (1 - v);
      worst = Math.max(worst, Math.abs(terrainAt(road, x, z, t3)[0] - tri));
    }
    expect(worst).toBeLessThan(1e-6);
  });
  it('off the road the car sits on that ground, wheels down', () => {
    const road = roads.atlantic, course = createRoadCourse(road);
    let checked = 0;
    for (let s = 500; s < road.length - 500 && checked < 4; s += 211) {
      const p = poseAt(road, s, 1), i = p.i, lx = road.dz[i], lz = -road.dx[i];
      for (const side of [1, -1]) {
        const x = road.x[i] + lx * side * (road.hw[i] + 40), z = road.z[i] + lz * side * (road.hw[i] + 40), q = { seg: -1, other: Infinity };
        if (nearestSeg(road, x, road.y[i], z, q)) continue;                       // land, away from every leg
        const t3 = [0, 0, 0], h = terrainAt(road, x, z, t3);
        if (h[1] * h[1] + h[2] * h[2] > 0.05 || h[0] < 3) continue;              // gentle enough to park on, out of the sea
        const car = createVehicle(course);
        car.pos.x = x; car.pos.y = h[0] + SPEC.comHeight + 0.3; car.pos.z = z;
        const hold = newInput(); hold.brake = 1;
        for (let t = 0; t < 240 * 2; t++) step(car, hold);
        expect(car.grounded).toBe(4);
        expect(Math.abs(car.pos.y - SPEC.comHeight - terrainAt(road, car.pos.x, car.pos.z, t3)[0])).toBeLessThan(0.12);
        // The hull's ground (the engine's heightfield) is that ground too, not above it.
        const w = car.world, ray = new RAPIER.Ray({ x: car.pos.x - w.ox, y: car.pos.y + 3 - w.oy, z: car.pos.z + 3 - w.oz }, { x: 0, y: -1, z: 0 });
        const hit = w.rw.castRay(ray, 20, true, undefined, (((0xffff << 16) | GROUP.approx) >>> 0));
        expect(Math.abs(car.pos.y + 3 - hit.timeOfImpact - terrainAt(road, car.pos.x, car.pos.z + 3, t3)[0])).toBeLessThan(0.02);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  }, 60_000);
  it('the ground under a point does not depend on how high you ask from (it did, by up to 70 m, above deep cuts)', () => {
    const course = createEndlessCourse('forest'), road = course.road, g = [0, 0, 0];
    road.ensure(6000);
    let n = 0;
    for (let i = 200; i < 1900; i += 37) for (const off of [12, 20, 30]) {
      const x = road.x[i] + road.dz[i] * (road.hw[i] + off), z = road.z[i] - road.dx[i] * (road.hw[i] + off), q = { seg: -1, other: Infinity };
      if (!nearestSeg(road, x, road.y[i], z, q) || q.other < 30) continue;           // one leg only
      const a = groundAt(road, x, road.y[i], z, g)[0], b = groundAt(road, x, road.y[i] + 60, z, g)[0], c = groundAt(road, x, road.y[i] - 40, z, g)[0];
      expect(Math.abs(a - b)).toBeLessThan(1e-9);
      expect(Math.abs(a - c)).toBeLessThan(1e-9);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });
  it('no cliff across the verge where the graded apron meets the land (2.8 m on the Stelvio)', () => {
    const road = roads.stelvio, g = [0, 0, 0];
    let worst = 0;
    for (let s = 300; s < road.length - 300; s += 41) {
      const i = poseAt(road, s, 1).i;
      if (road.flags[i] & 0x3f) continue;
      for (const side of [1, -1]) {
        const lx = road.dz[i], lz = -road.dx[i], q = { seg: -1, other: Infinity };
        let prev = null;
        for (let e = 6; e < 12; e += 0.02) {
          const x = road.x[i] + lx * side * (road.hw[i] + e), z = road.z[i] + lz * side * (road.hw[i] + e);
          nearestSeg(road, x, road.y[i], z, q);
          if (q.other - Math.abs(q.lat) < 8 || Math.abs(Math.abs(q.lat) - road.hw[i] - e) > 1) { prev = null; continue; }   // this cross-section's roadside, not where two legs' meet
          const y = groundAt(road, x, road.y[i], z, g)[0];
          if (prev !== null) worst = Math.max(worst, Math.abs(y - prev));   // over 2 cm: a 1:1 cut rises 2 cm, a step all of it
          prev = y;
        }
      }
    }
    expect(worst).toBeLessThan(0.06);
  }, 60_000);
  it('off the road the tyres meet what is painted there: grass, rock on steep faces, sand at the shore', () => {
    const road = roads.bigsur, o = {};
    const seen = new Set();
    for (let k = 0; k < 3000; k++) {
      const i = (k * 4099) % road.n, x = road.x[i] + ((k * 31) % 160) - 80, z = road.z[i] + ((k * 17) % 160) - 80;
      const y = surfaceHeight((a, b, c, out) => roadSurface(road, a, b, c, out, true), x, z, road.y[i] + 40);
      roadSurface(road, x, y + 0.01, z, o, true);
      if (o.mat.id === 'asphalt' || o.mat.id === 'gravel') continue;
      seen.add(o.mat.id);
      if (1 - o.y > 0.41) expect(o.mat).toBe(MATERIALS.rock);
      else expect(o.mat).not.toBe(MATERIALS.rock);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['grass', 'rock']));
  });
  it('soft ground rolls harder: a car coasting on grass stops sooner than on asphalt', () => {
    const plane = (mat) => ({ id: 'plane', boxes: [], start: { x: 0, z: 0 }, runout: {}, sdf: (x, y, z, out) => { out.x = 0; out.y = 1; out.z = 0; out.mat = mat; out.obstacle = false; out.body = null; return y; } });
    const coast = (mat) => {
      const car = createVehicle(plane(mat));
      car.pos.y = SPEC.comHeight; car.vel.z = 15;
      for (const w of car.wheels) w.omega = 15 / 0.35;
      const inp = newInput();
      for (let t = 0; t < 240 * 6; t++) step(car, inp);
      return car.vel.z;
    };
    const asphalt = coast(MATERIALS.asphalt), grass = coast(MATERIALS.grass), sand = coast(MATERIALS.sand);
    expect(grass).toBeLessThan(asphalt - 1);
    expect(sand).toBeLessThan(grass - 1);
  });
});

describe('nothing solid that is not drawn', () => {
  it('a baked road: every collider near the car is the ground, a drawn rail, wall, arch, girder or pier, or a drawn tree', () => {
    const road = roads.bigsur, course = createRoadCourse(road);
    // Somewhere with a bridge (girders, piers) and woods.
    let k = 0;
    for (let i = 0; i < road.m; i++) if (road.flags[i] & 1 && i % 8 === 4) { k = i; break; }
    const car = createVehicle(course);
    car.pos.x = road.x[k]; car.pos.y = road.y[k] + 0.5; car.pos.z = road.z[k];
    step(car, newInput());
    const w = car.world, trees = new Map();
    for (const c of w.free.cells.values()) {
      const x0 = Math.floor((c.ix * CELL) / 128) * 128, z0 = Math.floor((c.iz * CELL) / 128) * 128;
      for (const t of bakedTrees(road, x0, z0)) trees.set(`${t.x},${t.z}`, t);
    }
    const kinds = { ground: 0, structure: 0, tree: 0, other: 0 };
    for (const c of colliders(w)) {
      if (c.shape === RAPIER.ShapeType.HeightField) { kinds.ground++; continue; }
      if (c.mat === MATERIALS.wood) {
        const t = [...trees.values()].find((q) => Math.abs(q.x - c.x) < 1e-3 && Math.abs(q.z - c.z) < 1e-3);
        expect(t).toBeTruthy();
        expect(c.col.radius()).toBeCloseTo(SHAPES[t.type].trunkR * t.sx, 4);
        kinds.tree++;
        continue;
      }
      // A box over a segment that carries a rail, a tunnel or a bridge.
      const q = { seg: -1, other: Infinity };
      if (c.approx && c.shape === RAPIER.ShapeType.Cuboid && nearestSeg(road, c.x, c.y, c.z, q) && (road.flags[q.seg] & 63 || road.flags[Math.max(0, q.seg - 1)] & 63 || road.flags[Math.min(road.m - 1, q.seg + 1)] & 63)) { kinds.structure++; continue; }
      kinds.other++;
    }
    expect(kinds.other).toBe(0);
    expect(kinds.ground).toBe(49);
    expect(kinds.structure).toBeGreaterThan(10);
    // Every tree in the built cells is solid.
    let inCells = 0;
    for (const t of trees.values()) if (w.free.cells.has(((Math.floor(t.z / CELL) + 1048576) * 2097152) + (Math.floor(t.x / CELL) + 1048576))) inCells++;
    expect(kinds.tree).toBe(inCells);
  }, 60_000);
  it('rails and walls are as tall as they are drawn', () => {
    // src/render/road.js draws the W-beam and the stone wall up to RAILS[k].h: the solids' tops.
    const src = readFileSync(new URL('../../src/render/road.js', import.meta.url), 'utf8');
    expect(src).toMatch(/\[0, r\.h\], \[0\.035, r\.h - 0\.09\]/);
    expect(src).toMatch(/\[0\.06, r\.h\], \[r\.t - 0\.06, r\.h\]/);
    expect(RAILS[1].h).toBeGreaterThan(0.7);
  });
  it('the Sandbox: the apron, its four masts, and the pieces placed on it; nothing else', () => {
    const store = createObjectStore(), course = composeCourse(createArenaCourse(), store);
    store.addObject({ type: 'kicker', transform: { x: 0, y: 0, z: 30, yaw: 0, scale: 1 } });
    store.addObject({ type: 'ring', transform: { x: 4, y: 0, z: 40, yaw: 0, scale: 1 } });   // a sensor: nothing
    const car = createVehicle(course);
    car.pos.x = 0; car.pos.y = SPEC.comHeight; car.pos.z = 10;
    step(car, newInput());
    const cs = colliders(car.world);
    expect(cs.filter((c) => c.shape === RAPIER.ShapeType.Cuboid && c.y < 0).length).toBe(1);            // the apron
    expect(cs.filter((c) => c.shape === RAPIER.ShapeType.ConvexPolyhedron).length).toBe(14);            // the kicker, in slices
    expect(cs.length).toBe(15);                                                                          // masts are 200 m off
    // A mast stops the car.
    const r = ram(course, MASTS[3].x, MASTS[3].z, 0);
    expect(r.past).toBeLessThan(-1.5);
    expect(r.v).toBeLessThan(3);
    // A piece's body: a parked-car block stops the hull (only the tyres met it before).
    store.addObject({ type: 'car', transform: { x: 60, y: 0, z: 0, yaw: Math.PI / 2, scale: 1 } });
    const c = ram(course, 60, 0, 0, { speed: 16 });
    expect(c.hull).toBeGreaterThan(0);
    expect(c.past).toBeLessThan(-1);
  }, 60_000);
  it('the world API\'s objects (endless) are hull colliders too: a block across the road stops the car', () => {
    const course = createEndlessCourse('objects'), road = course.road;
    road.ensure(3000);
    course.objects = createObjects({ seed: road.seed, groundY: (x, z) => road.dem(x, z, [0, 0, 0])[0] });
    const p = poseAt(road, 600, 1), tx = road.dx[p.i], tz = road.dz[p.i], g = ground(course, p.x, p.z, p.y);
    course.objects.add({ type: 'box', x: p.x, y: g.y, z: p.z, yaw: Math.atan2(tx, tz), w: 6, l: 1, h: 1.6 });
    const r = ram(course, p.x, p.z, p.y, { dir: { x: tx, z: tz }, speed: 16 });
    expect(r.past).toBeLessThan(-1);
    expect(r.v).toBeLessThan(3);
  }, 60_000);
});

describe('one placement, deterministic', () => {
  it('the same tile gives the same props; the boulder hull is the drawn boulder\'s 42 vertices', () => {
    const course = createEndlessCourse('det'), road = course.road;
    road.ensure(3000);
    const a = endlessProps(road, 0, Math.floor(road.x[500] / 128) * 128, Math.floor(road.z[500] / 128) * 128, 128, VEG_SPACING);
    const b = endlessProps(road, 0, Math.floor(road.x[500] / 128) * 128, Math.floor(road.z[500] / 128) * 128, 128, VEG_SPACING);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(rockPoints().length).toBe(42 * 3);
  });
  it('src/sim/scenery.js keeps to deterministic math', () => {
    const src = readFileSync(new URL('../../src/sim/scenery.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|pow|exp|log|random)\b|[\w)\]]\s*\*\*\s*[\w(]/);
    expect(src).not.toMatch(/Date\.now|performance\.now/);
    const world = readFileSync(new URL('../../src/sim/world.js', import.meta.url), 'utf8');
    expect(world).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|hypot|pow|exp|log|random)\b/);
  });
  it('a drive through the woods replays bit-exactly (streamed trunks and all)', () => {
    const run = () => {
      const course = createEndlessCourse('forest'), road = course.road, p = poseAt(road, 300, 1);
      const car = createVehicle(course);
      car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight + 0.04; car.pos.z = p.z;
      car.quat.y = Math.sin(p.yaw / 2); car.quat.w = Math.cos(p.yaw / 2);
      const inp = newInput(); inp.throttle = 0.8; inp.steer = 0.15;   // off the road, into whatever stands there
      for (let t = 0; t < 240 * 8; t++) step(car, inp);
      return car;
    };
    const a = run(), b = run();
    for (const k of ['x', 'y', 'z']) { expect(a.pos[k]).toBe(b.pos[k]); expect(a.vel[k]).toBe(b.vel[k]); }
  }, 60_000);
});
