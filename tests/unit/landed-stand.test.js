// 0355: the landed camera never stands in a set's splash tank, and sees the wheels and the mark's ring past it.
// The director is driven frame by frame (60 Hz) along the Show's and the Lineup's reference flights from the release to
// the car at rest, at an upright phone (390×844), a short one (393×659) and a desktop (1440×900), with the flight as
// flown and shifted 4 m either side of the mark; from the touchdown on, every frame is checked, the ease included.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { createRun, stepRun, armAftermath, aftermathStep } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { COURSES } from '../../src/sim/courses.js';
import { createDirector } from '../../src/render/director.js';
import { tankBoxes, inTank, sightBlocked, wheelsInSight, ringInSight, standClear, RING_MIN } from '../../src/render/tank-sight.js';

// The reference flight as the director sees it: position, velocity and phase every 4 ticks, then the aftermath to rest.
function flight(course) {
  const run = createRun(course), ap = createAutopilot(course), out = [];
  const rec = () => { const c = run.car; out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, vx: c.vel.x, vy: c.vel.y, vz: c.vel.z, phase: run.phase }); };
  while (run.phase !== 'done') { stepRun(run, ap(run)); if (run.tick % 4 === 0) rec(); }
  armAftermath(run);
  while (!aftermathStep(run)) if (run.tick % 4 === 0) rec();
  for (let i = 0; i < 120; i++) rec();   // two seconds at rest, as the results come up
  return out;
}

// The check, independent of src/render/tank-sight.js (which the director steers by): each tank's box straight from the
// course data, a segment sampled every 2 cm, and a point over the water (a splashed car) exempt from its own tank.
function rawTanks(course) {
  return (COURSES[course].surfaces?.tanks || []).map((k) => ({ x0: k.x0 - k.wall, x1: k.x1 + k.wall, z0: k.z0 - k.wall, z1: k.z1 + k.wall, top: k.top, k }));
}
const inside = (t, x, y, z, m = 0) => x > t.x0 - m && x < t.x1 + m && z > t.z0 - m && z < t.z1 + m && y < t.top + m;
function hidden(tanks, a, b) {
  for (const t of tanks) {
    if (b.x > t.k.x0 && b.x < t.k.x1 && b.z > t.k.z0 && b.z < t.k.z1) continue;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.02);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (inside(t, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f)) return true;
    }
  }
  return false;
}
// What the frame owes the player (the ticket's first criterion): the camera outside every tank grown by 0.5 m, the four
// wheel contacts in sight, ≥ 14 of the ring's 16 points while the car is near the mark.
function frameFaults(course, s) {
  const tanks = rawTanks(course), pad = COURSES[course].pad, p = s.cam, c = s.car, out = [];
  if (tanks.some((t) => inside(t, p.x, p.y, p.z, 0.5))) out.push(`in a tank at ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`);
  for (const [dx, dz] of [[-0.82, -1.42], [0.82, -1.42], [-0.82, 1.42], [0.82, 1.42]]) {
    if (hidden(tanks, p, { x: c.x + dx, y: 0.05, z: c.z + dz })) { out.push('a wheel behind a tank'); break; }
  }
  if (Math.hypot(c.x - pad.x, c.z - pad.z) < 12) {
    let seen = 0;
    for (let i = 0; i < 16; i++) if (!hidden(tanks, p, { x: pad.x + 4 * Math.cos(i * Math.PI / 8), y: 0.02, z: pad.z + 4 * Math.sin(i * Math.PI / 8) })) seen++;
    if (seen < 14) out.push(`the ring ${seen}/16`);
  }
  return out;
}

const VIEWS = [[390, 844], [393, 659], [1440, 900]];
const SHIFTS = [0, -4, 4];
const pos = new THREE.Vector3(), vel = new THREE.Vector3();

// Every frame from the touchdown on: the camera, and how much of the wheels and the ring it sees.
function landedFrames(course, frames, [w, h], dx) {
  globalThis.innerWidth = w; globalThis.innerHeight = h;   // the director reads the window's size (frameOffset)
  const cam = new THREE.PerspectiveCamera(52, w / h, 0.1, 2000);
  const dir = createDirector(cam);
  dir.restart();
  const seen = [];
  let down = false;
  for (const f of frames) {
    pos.set(f.x + dx, f.y, f.z); vel.set(f.vx, f.vy, f.vz);
    dir.update(1 / 60, 0, { carPos: pos, carVel: vel, phase: f.phase, mode: 'live', course });
    if (f.phase === 'landed' || f.phase === 'done') down = true;
    if (!down) continue;
    cam.updateMatrixWorld();
    seen.push({ cam: cam.position.clone(), car: pos.clone(), fov: cam.fov, aspect: cam.aspect, q: cam.quaternion.clone() });
  }
  return seen;
}

describe('the tank sight helpers', () => {
  const bx = tankBoxes(COURSES.show);
  it('a tank is its walls\' footprint from the slab to the coping; the Wall has none', () => {
    expect(Array.from(bx)).toEqual([9.6, 0, -40.4, 18.4, 1.1, -23.6, 0.4]);
    expect(tankBoxes(COURSES.wall).length).toBe(0);
  });
  it('the stand that was in the tank (0119\'s +12 m beside the reference touchdown) is caught', () => {
    const car = { x: 0.71, y: 0.4, z: -29.9 };
    expect(inTank(bx, car.x + 12, 1.25, car.z)).toBe(true);
    expect(standClear(bx, car.x + 12, 1.25, car.z, car, COURSES.show.pad)).toBe(false);
    // the same stand swung 60° round the car toward +z, past the tank's corner, sees all of it
    const x = car.x + 6, z = car.z + 12 * Math.sin(Math.PI / 3);
    expect(standClear(bx, x, 1.25, z, car, COURSES.show.pad)).toBe(true);
    expect(wheelsInSight(bx, x, 1.25, z, car)).toBe(4);
    expect(ringInSight(bx, x, 1.25, z, COURSES.show.pad)).toBe(16);
  });
  it('a sight line into a tank the target is in is allowed (a car that splashed in), one past a wall is not', () => {
    expect(sightBlocked(bx, 22, 1.25, -30, 14, 0.4, -30)).toBe(false);
    expect(sightBlocked(bx, 22, 1.25, -30, 0, 0.05, -30)).toBe(true);
    expect(sightBlocked(bx, 22, 3, -30, 0, 0.05, -30)).toBe(false);   // high enough to see over the coping
    // a wheel against the outside of a wall is not in the tank: the tank still hides it from the far side
    expect(sightBlocked(bx, 22, 1.25, -30, 9.4, 0.05, -30)).toBe(true);
  });
});

for (const course of ['show', 'lineup']) {
  describe(`${course}: the landed camera stays out of the tank`, () => {
    let frames;
    beforeAll(() => { frames = flight(course); });
    for (const view of VIEWS) for (const dx of SHIFTS) {
      it(`${view.join('×')}, the flight ${dx ? `${dx > 0 ? '+' : ''}${dx} m off` : 'as flown'}: never in a tank, wheels and ring in sight`, () => {
        const seen = landedFrames(course, frames, view, dx);
        expect(seen.length).toBeGreaterThan(60);
        const bad = [];
        for (const [i, s] of seen.entries()) for (const f of frameFaults(course, s)) bad.push(`${i}: ${f}`);
        expect(bad.slice(0, 5)).toEqual([]);
      });
    }
  });
}

// A flight that drifts 13 m wide comes down in the Show's tank: the rig may look into it, never stand in it.
describe('show: a run that ends in the tank', () => {
  for (const view of VIEWS) {
    it(`${view.join('×')}: the camera never stands in the tank, and sees the car over the water`, () => {
      const seen = landedFrames('show', flight('show'), view, 13);
      const t = rawTanks('show')[0], last = seen[seen.length - 1];
      expect(last.car.x > t.k.x0 && last.car.x < t.k.x1).toBe(true);   // the car is over the water
      const bad = [];
      for (const [i, s] of seen.entries()) for (const f of frameFaults('show', s)) bad.push(`${i}: ${f}`);
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});

describe('0108 and 0119 still hold on the Show at rest', () => {
  for (const view of VIEWS.slice(0, 2)) for (const dx of SHIFTS) it(`${view.join('×')}, ${dx} m off: the car under 0.75 of the width, below the middle, the view toward −x`, () => {
    const frames = flight('show');
    const seen = landedFrames('show', frames, view, dx);
    const s = seen[seen.length - 1];
    const cam = new THREE.PerspectiveCamera(s.fov, s.aspect, 0.1, 2000);
    cam.position.copy(s.cam); cam.quaternion.copy(s.q); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    let lo = Infinity, hi = -Infinity, cy = 0;
    for (const [ox, oz] of [[-0.95, -2.33], [0.95, -2.33], [-0.95, 2.33], [0.95, 2.33]]) {
      for (const y of [0, 1.2]) {
        const v = new THREE.Vector3(s.car.x + ox, y, s.car.z + oz).project(cam);
        lo = Math.min(lo, v.x); hi = Math.max(hi, v.x);
      }
    }
    cy = new THREE.Vector3(s.car.x, s.car.y, s.car.z).project(cam).y;
    expect((hi - lo) / 2).toBeLessThan(0.75);
    expect(cy).toBeLessThan(0);
    // 0119's broadside, swung round the car only as far as the tank's corner asks: still at +x, still looking toward −x
    expect(s.cam.x).toBeGreaterThan(s.car.x + 4);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(s.q).x).toBeLessThan(-0.3);
  });
});
