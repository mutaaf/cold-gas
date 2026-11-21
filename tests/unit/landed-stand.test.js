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
    expect(Array.from(bx)).toEqual([9.6, 0, -40.4, 18.4, 1.1, -23.6]);
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
  });
});

for (const course of ['show', 'lineup']) {
  describe(`${course}: the landed camera stays out of the tank`, () => {
    let frames;
    beforeAll(() => { frames = flight(course); });
    const bx = tankBoxes(COURSES[course]), pad = COURSES[course].pad;
    for (const view of VIEWS) for (const dx of SHIFTS) {
      it(`${view.join('×')}, the flight ${dx ? `${dx > 0 ? '+' : ''}${dx} m off` : 'as flown'}: never in a tank, wheels and ring in sight`, () => {
        const seen = landedFrames(course, frames, view, dx);
        expect(seen.length).toBeGreaterThan(60);
        const bad = [];
        for (const [i, s] of seen.entries()) {
          const p = s.cam;
          if (inTank(bx, p.x, p.y, p.z)) bad.push(`${i}: in a tank at ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`);
          else if (wheelsInSight(bx, p.x, p.y, p.z, s.car) < 4) bad.push(`${i}: a wheel behind a tank`);
          else if (Math.hypot(s.car.x - pad.x, s.car.z - pad.z) < 12 && ringInSight(bx, p.x, p.y, p.z, pad) < RING_MIN) bad.push(`${i}: the ring behind a tank`);
        }
        expect(bad.slice(0, 5)).toEqual([]);
      });
    }
  });
}

describe('0108 and 0119 still hold on the Show at 390×844', () => {
  it('the car at rest is under 0.75 of the width, below the middle, still looking across it toward the launch complex (−x)', () => {
    const frames = flight('show');
    const seen = landedFrames('show', frames, [390, 844], 0);
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
    // 0119's broadside, swung round the car past the tank's corner: still at +x, still looking toward −x
    expect(s.cam.x).toBeGreaterThan(s.car.x + 4);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(s.q).x).toBeLessThan(-0.5);
  });
});
