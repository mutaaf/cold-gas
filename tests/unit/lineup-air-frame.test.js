// 0358: the Lineup's kickflip shot keeps the whole car in frame on a phone, and no floodlight pole crosses it.
// The director is driven at 60 Hz along the Lineup reference (and a lower and a higher kickflip), the sim and the
// camera stepped together as the page does. Every air frame: the share of the car's projected box (its eight corners,
// the car's attitude applied) that is on screen, and how much of that box's width a pole nearer the lens than the car
// covers. The poles come from FIXTURES (courses.js), never a copy.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { FIXTURES } from '../../src/sim/courses.js';
import { createDirector } from '../../src/render/director.js';

const STEP = 1 / 240;   // the sim's tick
const PER_FRAME = 4;    // ticks per 60 Hz frame

// The car's box about its origin, as the critic's probe (docs/critique/2026-11-22-2230/lineup-frame.mjs.txt) reads it.
const CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-0.5, 1]) for (const sz of [-1, 1]) CORNERS.push(new THREE.Vector3(sx * 1.0, sy * 0.575 + 0.2, sz * 2.325));
const POLES = [];
for (let z = FIXTURES.poles.z0; z < FIXTURES.poles.z1; z += FIXTURES.poles.step) for (const sx of [-1, 1]) POLES.push({ x: sx * FIXTURES.poles.x, z });
const POLE_R = (FIXTURES.poles.r0 + FIXTURES.poles.r1) / 2;

function airFrames(opts, [w, h]) {
  globalThis.innerWidth = w; globalThis.innerHeight = h;
  const cam = new THREE.PerspectiveCamera(52, w / h, 0.1, 2000);
  const dir = createDirector(cam);
  dir.restart();
  const run = createRun('lineup'), ap = createAutopilot('lineup', opts);
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), q = new THREE.Quaternion(), v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const out = [];
  let t = 0;
  while (run.phase !== 'done' && run.tick < 240 * 40) {
    for (let i = 0; i < PER_FRAME && run.phase !== 'done'; i++) stepRun(run, ap(run));
    t += PER_FRAME * STEP;
    const c = run.car;
    pos.set(c.pos.x, c.pos.y, c.pos.z); vel.set(c.vel.x, c.vel.y, c.vel.z);
    dir.update(1 / 60, t, { carPos: pos, carVel: vel, phase: run.phase, mode: 'live', course: 'lineup' });
    if (run.phase !== 'air') continue;
    cam.updateMatrixWorld();
    q.set(c.quat.x, c.quat.y, c.quat.z, c.quat.w);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const k of CORNERS) {
      v.copy(k).applyQuaternion(q).add(pos).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const cl = (u) => Math.max(-1, Math.min(1, u));
    const on = (Math.max(0, cl(x1) - cl(x0)) * Math.max(0, cl(y1) - cl(y0))) / ((x1 - x0) * (y1 - y0));
    const dCar = cam.position.distanceTo(pos);
    let cover = 0;
    for (const p of POLES) {
      a.set(p.x, Math.min(FIXTURES.poles.h - 0.1, c.pos.y), p.z);
      if (cam.position.distanceTo(a) >= dCar) continue;
      // The pole's half width on screen, across the line of sight.
      b.set(POLE_R, 0, 0).applyQuaternion(cam.quaternion).add(a).project(cam);
      a.project(cam);
      if (a.z > 1 || a.z < -1) continue;
      const hw = Math.abs(b.x - a.x);
      cover = Math.max(cover, Math.max(0, Math.min(x1, a.x + hw) - Math.max(x0, a.x - hw)) / (x1 - x0));
    }
    out.push({ t: run.tick / 240, y: c.pos.y, z: c.pos.z, on, cover, x0, x1 });
  }
  return out;
}

const PHONES = [[390, 844], [430, 932], [360, 780]];
const DESKS = [[1440, 900], [1280, 720]];
const FLIGHTS = [['the reference', undefined], ['apex 4 m', { apex: 4 }], ['apex 6.5 m', { apex: 6.5 }]];

describe('0358 the Lineup kickflip shot', () => {
  for (const [name, opts] of FLIGHTS) {
    for (const view of [...PHONES, ...DESKS]) {
      it(`${name} at ${view.join('×')}: the whole car on screen, no pole across it, every air frame`, () => {
        const f = airFrames(opts, view);
        expect(f.length).toBeGreaterThan(60);
        const worst = f.reduce((m, r) => (r.on < m.on ? r : m));
        expect(worst.on, `on-screen share at t ${worst.t.toFixed(2)} (box x ${worst.x0.toFixed(2)}…${worst.x1.toFixed(2)})`).toBeGreaterThanOrEqual(view[0] > view[1] ? 0.999 : 0.98);
        const pole = f.reduce((m, r) => (r.cover > m.cover ? r : m));
        expect(pole.cover, `pole cover at t ${pole.t.toFixed(2)} z ${pole.z.toFixed(1)}`).toBeLessThanOrEqual(0.05);
      });
    }
  }
});
