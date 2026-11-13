// 0229: "Turning left and crashing into a pole caused the game to break." The sim is deterministic, so the
// playtester's crash replays here. What breaks is not the engine (no NaN, no trap, no deep penetration
// anywhere below) but the run: a car that turns hard off its line on the run-up stops dead against a set
// light's drum or a lamp post, upright on its wheels, and no end condition of a scored run matches a car
// still in its 'drive' phase, so it sits there until MAX_TICKS (90 s) with a frozen HUD. The scored sim is
// left alone (the replays stay bit-identical); the app sees the wedge (src/wedge.js) and goes again from the
// mark, and Free Drive and the Sandbox put the car back on the road.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRun, stepRun, armAftermath, aftermathStep, MAX_TICKS } from '../../src/sim/run.js';
import { createVehicle, step, newInput, HULL, DT } from '../../src/sim/vehicle.js';
import { quatFromYaw } from '../../src/sim/m3.js';
import { SPEC } from '../../src/sim/spec.js';
import { fixturesOf } from '../../src/sim/courses.js';
import { parseRoad, buildRoad, createRoadCourse, poseAt, RAILS } from '../../src/sim/roads.js';
import { bakedScenery, CELL } from '../../src/sim/scenery.js';
import { createWedge, carFinite, WEDGE_PUSH, WEDGE_IDLE, WEDGE_R } from '../../src/wedge.js';

const car = (o = {}) => ({ pos: { x: 0, y: 0.4, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, angVel: { x: 0, y: 0, z: 0 }, hullContact: true, ...o });

describe('the wedge detector (src/wedge.js)', () => {
  it('fires after WEDGE_PUSH s going nowhere, touching something, with the pedal down', () => {
    const w = createWedge(), c = car();
    let t = 0;
    while (!w.update(DT, c, 1) && t < 10) t += DT;
    expect(t).toBeGreaterThan(WEDGE_PUSH - 2 * DT);
    expect(t).toBeLessThan(WEDGE_PUSH + 2 * DT);
  });
  it('a car pinned and jittering in place (0.1–0.7 m/s, no headway) is stuck too', () => {
    const w = createWedge(), c = car();
    let t = 0;
    while (!w.update(DT, c, 1) && t < 10) { t += DT; c.vel.z = 0.7 * Math.sin(t * 40); c.pos.z = 0.002 * Math.sin(t * 40); }
    expect(t).toBeLessThan(WEDGE_PUSH + 2 * DT);
  });
  it('no pedal: only where an idle limit is given; headway or never touching resets it', () => {
    const c = car();
    const free = createWedge();
    for (let i = 0; i < 240 * 10; i++) expect(free.update(DT, c, 0)).toBe(false);
    const w = createWedge({ idle: WEDGE_IDLE });
    let t = 0;
    while (!w.update(DT, c, 0) && t < 10) t += DT;
    expect(t).toBeGreaterThan(WEDGE_IDLE - 2 * DT);
    w.reset();
    for (let i = 0; i < 200; i++) w.update(DT, c, 1);
    expect(w.update(DT, car({ pos: { x: 0, y: 0.4, z: WEDGE_R + 0.1 } }), 1)).toBe(false);   // got going: a new anchor
    expect(w.t).toBe(0);
    const clear = createWedge();
    for (let i = 0; i < 240 * 3; i++) expect(clear.update(DT, car({ hullContact: false }), 1)).toBe(false);   // stopped on its tyres
  });
  it('carFinite catches a NaN anywhere the engine is fed', () => {
    expect(carFinite(car())).toBe(true);
    expect(carFinite(car({ vel: { x: NaN, y: 0, z: 0 } }))).toBe(false);
    expect(carFinite(car({ quat: { x: 0, y: 0, z: 0, w: Infinity } }))).toBe(false);
    expect(carFinite(null)).toBe(false);
  });
});

// A scored run flown with the stick held over: returns the tick the app's detector fires (−1: never), and how
// the sim alone would end it.
function scored(course, steer, from = 0, toEnd = false) {
  const run = createRun(course);
  const w = createWedge({ idle: WEDGE_IDLE }), inp = newInput();
  let fired = -1;
  while (run.phase !== 'done') {
    inp.throttle = 1; inp.assist = 1; inp.steer = run.tick >= from ? steer : 0;
    stepRun(run, inp);
    expect(carFinite(run.car)).toBe(true);
    if (fired < 0 && run.phase === 'drive' && !run.t.contact && w.update(DT, run.car, inp.throttle)) {
      fired = run.tick;
      if (!toEnd) break;
    }
  }
  return { run, fired };
}

describe('0229 repro: a scored run wedged against a fixture', () => {
  it('the Wall, stick hard over from Go: the car curls into a set light and the sim alone sits to the 90 s cap', () => {
    const { run, fired } = scored('wall', 1, 0, true);
    // The car stops dead against the drum at (9, 15) about 8 s in; the sim never ends it.
    expect(run.t.endReason).toBe('timeout');
    expect(run.tick).toBeGreaterThanOrEqual(MAX_TICKS);
    expect(Math.hypot(run.car.pos.x - 9, run.car.pos.z - 15)).toBeLessThan(3.5);
    // The app's detector sees it within ~2 s of the stop, and long before the cap.
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(240 * 12);
  });
  it('the Show, the other way: the same wedge, seen as fast', () => {
    const { run, fired } = scored('show', -1);
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(240 * 15);
    expect(run.phase).toBe('drive');
  });
  it('the Lineup, steering into a lamp post from 1.5 s: seen', () => {
    const { run, fired } = scored('lineup', -0.6, 360);
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(240 * 12);
    const posts = fixturesOf('lineup');
    const near = Math.min(...posts.map((f) => Math.hypot(run.car.pos.x - f.x, run.car.pos.z - f.z)));
    expect(near).toBeLessThan(3.2);
  });
  it('a run that ends on its own still ends, and its aftermath finishes', () => {
    // Wide circles at a lighter stick: off the end of the course (runout), then the aftermath comes to rest.
    const run = armAftermath(createRun('lineup'));
    const inp = newInput(); inp.throttle = 1; inp.assist = 1; inp.steer = 0.5;
    while (run.phase !== 'done') stepRun(run, inp);
    expect(['runout', 'timeout', 'flipped', 'contact', 'settled', 'no-jump', 'stalled']).toContain(run.t.endReason);
    let k = 0;
    while (!aftermathStep(run) && k++ < 240 * 7);
    expect(run.after.done).toBe(true);
  });
});

// Half the hull's footprint (m): how far a pole's axis may sit inside it before it's "inside the car".
let HX = 0, HZ = 0;
for (const p of HULL) { HX = Math.max(HX, Math.abs(p.x)); HZ = Math.max(HZ, Math.abs(p.z)); }
function insideBy(c, px, pz) {
  const q = c.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), n = Math.hypot(fx, fz) || 1;
  const dx = px - c.pos.x, dz = pz - c.pos.z, lz = (dx * fx + dz * fz) / n, lx = (dx * fz - dz * fx) / n;
  return Math.min(HX - Math.abs(lx), HZ - Math.abs(lz));
}
// Drive c (already placed and aimed) at full throttle; never NaN, never through, and either it gets going again
// or the detector sees it stuck.
function ram(c, px, pz, r, ticks = 2400) {
  const inp = newInput(); inp.throttle = 1;
  const w = createWedge();
  let deepest = -Infinity, deepFor = 0, maxDeepFor = 0, fired = false;
  for (let k = 0; k < ticks; k++) {
    step(c, inp);
    if (!carFinite(c)) throw new Error(`non-finite car at tick ${k}`);
    const d = insideBy(c, px, pz) + r;
    deepest = Math.max(deepest, d);
    deepFor = d > 0.5 ? deepFor + 1 : 0; maxDeepFor = Math.max(maxDeepFor, deepFor);
    if (w.update(DT, c, 1)) { fired = true; break; }
  }
  return { deepest, maxDeepFor, fired, moving: Math.hypot(c.vel.x, c.vel.z) > 0.5 };
}
function aim(c, x, z, tx, tz, speed) {
  const yaw = Math.atan2(tx - x, tz - z);
  c.pos.x = x; c.pos.z = z;
  quatFromYaw(c.quat, yaw);
  c.vel.x = Math.sin(yaw) * speed; c.vel.z = Math.cos(yaw) * speed;
  for (const wh of c.wheels) wh.omega = speed / SPEC.wheelRadius;
}

describe('0229: straight into poles, trunks and rails, 5–60 m/s', () => {
  it('the Lineup\'s lamp posts: never NaN, never through the car, never stuck unseen', () => {
    const f = fixturesOf('lineup')[2];
    for (const speed of [5, 15, 30, 45, 60]) for (const off of [0, -0.8]) for (const ang of [0, 45]) {
      const run = createRun('lineup'), c = run.car, a = (ang * Math.PI) / 180, back = 7;
      aim(c, f.x + off - back * Math.sin(a), f.z - back * Math.cos(a), f.x + off, f.z, speed);
      const r = ram(c, f.x, f.z, f.r);
      expect(r.maxDeepFor, `pole ${speed} m/s off ${off} at ${ang}°`).toBeLessThan(240);
      expect(r.fired || r.moving, `pole ${speed} m/s off ${off} at ${ang}°: stuck unseen`).toBe(true);
    }
  });

  let road = null;
  const loadRoad = () => {
    if (road) return road;
    const raw = gunzipSync(readFileSync(new URL('../../public/roads/stelvio.bin.gz', import.meta.url)));
    return (road = buildRoad(parseRoad(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))));
  };

  it('Free Drive\'s tree trunks (Stelvio): never NaN, no lasting penetration, never stuck unseen', () => {
    const rd = loadRoad(), sc = bakedScenery(rd), trunks = [];
    for (let s = 100; s < 3000 && trunks.length < 3; s += 97) {
      const p = poseAt(rd, s, 1), out = [];
      sc.cell(Math.floor(p.x / CELL), Math.floor(p.z / CELL), out);
      const t = out.find((o) => o.kind === 'trunk');
      if (t) trunks.push(t);
    }
    expect(trunks.length).toBe(3);
    for (const t of trunks) for (const speed of [6, 30, 60]) for (const ang of [0, 40]) {
      const c = createVehicle(createRoadCourse(rd, { name: 'test' })), a = (ang * Math.PI) / 180;
      c.pos.y = t.y + SPEC.comHeight + 0.3;
      aim(c, t.x - 8 * Math.sin(a), t.z - 8 * Math.cos(a), t.x, t.z, speed);
      const r = ram(c, t.x, t.z, t.r, 1440);
      expect(r.maxDeepFor, `trunk r ${t.r} ${speed} m/s ${ang}°`).toBeLessThan(240);
      expect(r.fired || r.moving, `trunk r ${t.r} ${speed} m/s ${ang}°: stuck unseen`).toBe(true);
    }
  });

  it('Free Drive\'s roadside walls (Stelvio\'s stone), square on and glancing: never NaN, never stuck unseen', () => {
    const rd = loadRoad();
    let i = -1;
    for (let k = 200; k < rd.n - 1; k++) if (((rd.flags[k] >> 2) & 3) && !(rd.flags[k] & 3)) { i = k; break; }
    expect(i).toBeGreaterThan(0);
    const p = poseAt(rd, i * rd.meta.spacing + rd.len[i] / 2, 1);
    const lx = rd.dz[i], lz = -rd.dx[i], off = rd.hw[i] + RAILS[(rd.flags[i] >> 2) & 3].off;
    for (const speed of [10, 30, 60]) for (const ang of [90, 30]) {
      const c = createVehicle(createRoadCourse(rd, { name: 'test' }));
      c.pos.y = p.y + SPEC.comHeight + 0.04;
      // From the road's centre toward the rail on the +lateral side, at ang° to the road.
      const a = (ang * Math.PI) / 180, tx = p.x + lx * off, tz = p.z + lz * off;
      const sx = tx - (lx * Math.sin(a) + rd.dx[i] * Math.cos(a)) * 8, sz = tz - (lz * Math.sin(a) + rd.dz[i] * Math.cos(a)) * 8;
      aim(c, sx, sz, tx, tz, speed);
      const r = ram(c, tx, tz, 0, 2400);   // over the wall it may tumble down the bank for a few seconds first
      expect(r.fired || r.moving, `rail ${speed} m/s ${ang}°: stuck unseen`).toBe(true);
    }
  });
});
