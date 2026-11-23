// 0358: the Lineup's kickflip shot keeps the whole car in frame on a phone, and no floodlight pole crosses it.
// The director is driven frame by frame (60 Hz) along the Lineup reference (and a lower and a higher kickflip) from the
// lift-off to the touchdown, at three upright phones and two desktops. Every air frame: the car's projected box (its
// eight corners, turned with the car, as docs/critique/2026-11-22-2230/lineup-frame.mjs.txt measures it) is ≥ 0.98 on
// screen, and no pole of the Lineup's (courses.js fixturesOf, never a copy) nearer the lens than the car covers more than
// 5 % of the car's screen width.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { fixturesOf } from '../../src/sim/courses.js';
import { createDirector } from '../../src/render/director.js';

// The flight as the director sees it, every 4 ticks (60 Hz) to two seconds past the touchdown.
function flight(opts) {
  const run = createRun('lineup'), ap = createAutopilot('lineup', opts), out = [];
  let after = -1;
  while (run.phase !== 'done' && after < 480) {
    stepRun(run, ap(run));
    if (run.phase === 'landed' && after < 0) after = 0;
    if (after >= 0) after++;
    if (run.tick % 4) continue;
    const c = run.car;
    out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, vx: c.vel.x, vy: c.vel.y, vz: c.vel.z, q: { ...c.quat }, phase: run.phase });
  }
  return out;
}

const POLES = fixturesOf('lineup').filter((f) => f.kind === 'cyl');
const v = new THREE.Vector3(), e = new THREE.Vector3(), q = new THREE.Quaternion(), side = new THREE.Vector3();

// The car's box on screen (NDC) and the worst pole's cover of its width.
function measure(cam, f) {
  q.set(f.q.x, f.q.y, f.q.z, f.q.w);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-0.5, 1]) for (const sz of [-1, 1]) {
    v.set(sx * 1.0, sy * 0.575 + 0.2, sz * 2.325).applyQuaternion(q).add(e.set(f.x, f.y, f.z)).project(cam);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const cl = (a) => Math.max(-1, Math.min(1, a));
  const on = (Math.max(0, cl(x1) - cl(x0)) * Math.max(0, cl(y1) - cl(y0))) / ((x1 - x0) * (y1 - y0));
  const dCar = cam.position.distanceTo(e.set(f.x, f.y, f.z));
  let cover = 0;
  side.set(1, 0, 0).applyQuaternion(cam.quaternion);
  for (const p of POLES) {
    const y = Math.min(p.hh * 2 - 0.1, f.y);
    e.set(p.x, y, p.z);
    if (cam.position.distanceTo(e) >= dCar) continue;
    if (e.clone().applyMatrix4(cam.matrixWorldInverse).z > -0.1) continue;   // behind the lens
    const a = e.clone().project(cam).x, b = e.clone().addScaledVector(side, p.r).project(cam).x, hw = Math.abs(b - a);
    cover = Math.max(cover, Math.max(0, Math.min(x1, a + hw) - Math.max(x0, a - hw)) / (x1 - x0));
  }
  return { on, cover, x0, x1 };
}

function airFrames(frames, [w, h]) {
  globalThis.innerWidth = w; globalThis.innerHeight = h;
  const cam = new THREE.PerspectiveCamera(52, w / h, 0.1, 2000);
  const dir = createDirector(cam);
  dir.restart();
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), out = [];
  for (const f of frames) {
    pos.set(f.x, f.y, f.z); vel.set(f.vx, f.vy, f.vz);
    dir.update(1 / 60, 0, { carPos: pos, carVel: vel, phase: f.phase, mode: 'live', course: 'lineup' });
    if (f.phase !== 'air') continue;
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    out.push({ ...measure(cam, f), y: f.y, z: f.z, cam: cam.position.clone() });
  }
  return out;
}

const PHONES = [[390, 844], [430, 932], [360, 780]], DESKS = [[1440, 900], [1280, 720]];
const FLIGHTS = { reference: undefined, 'apex 4': { apex: 4 }, 'apex 6.5': { apex: 6.5 } };

for (const [name, opts] of Object.entries(FLIGHTS)) {
  describe(`0358 lineup, ${name}: the whole car in frame in the air, no pole across it`, () => {
    let frames;
    beforeAll(() => { frames = flight(opts); });
    for (const view of [...PHONES, ...DESKS]) {
      it(`${view.join('×')}`, () => {
        const air = airFrames(frames, view);
        expect(air.length).toBeGreaterThan(60);
        const bad = [];
        for (const [i, s] of air.entries()) {
          if (s.on < 0.98) bad.push(`${i} (z ${s.z.toFixed(1)}, y ${s.y.toFixed(1)}): ${s.on.toFixed(2)} on screen, x ${s.x0.toFixed(2)}…${s.x1.toFixed(2)}`);
          if (s.cover > 0.05) bad.push(`${i} (z ${s.z.toFixed(1)}): a pole across ${s.cover.toFixed(2)} of the car, camera ${s.cam.x.toFixed(1)}, ${s.cam.z.toFixed(1)}`);
        }
        expect(bad.slice(0, 6)).toEqual([]);
      });
    }
  });
}
