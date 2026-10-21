// The rigid-body engine under the sim (Rapier, src/sim/engine.js + world.js) and the force models
// on top of it, checked against the numbers they are built from: every parked vehicle is its own
// body (mass, CoM, inertia, suspension, parked tyres), the tyre curves peak where the spec says,
// the springs ring at their design frequency, and the engine is deterministic.
import { describe, it, expect } from 'vitest';
import { createWorld, preStep, stepEngine, raycast } from '../../src/sim/world.js';
import { LINEUP, SHOW, WALL, wallProfile, PARK_MU, parkedPhysics, LINEUP_SPEC, MATERIALS } from '../../src/sim/courses.js';
import { createVehicle, step, newInput, tyreFx, tyreFy, CAR } from '../../src/sim/vehicle.js';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { SPEC } from '../../src/sim/spec.js';
import { RAPIER } from '../../src/sim/engine.js';
import { engineSpike } from '../../scripts/engine-spike.js';

const G = 9.81;
const tick = (w, n = 1) => { for (let i = 0; i < n; i++) { preStep(w); stepEngine(w); } };
const upY = (b) => 1 - 2 * (b.qx * b.qx + b.qz * b.qz);

describe('the engine', () => {
  it('is the deterministic build, and a chaotic scene steps to the same bits every time', () => {
    expect(RAPIER.version()).toMatch(/^0\.21\./);
    const a = engineSpike(RAPIER, 600), b = engineSpike(RAPIER, 600);
    expect(a).toEqual(b);
  });
  it('the Wall is an engine collider exactly on its profile: a ray down the deck normal lands on it', () => {
    const w = createWorld(WALL);
    for (const s of [3, 10, 20, 30, 38, 43]) {
      const p = wallProfile(s);
      // From 1 m out along the normal, straight back at the deck.
      const t = raycast(w, 0, p.y + p.ny, p.z + p.nz, 0, -p.ny, -p.nz, 3);
      expect(Math.abs(t - 1)).toBeLessThan(0.002);   // 20 cm facets on a 13.5 m arc: < 0.4 mm off
      expect(w.hit.ny * p.ny + w.hit.nz * p.nz).toBeGreaterThan(0.999);
      expect(w.hit.mat).toBe(MATERIALS.deck);
    }
  });
  it('the landing mark is paint on the concrete: its own grip, no step', () => {
    const w = createWorld(SHOW);
    expect(raycast(w, SHOW.pad.x, 1, SHOW.pad.z, 0, -1, 0, 2)).toBeCloseTo(1, 5);
    expect(w.hit.mat).toBe(MATERIALS.pad);
    expect(raycast(w, 30, 1, 0, 0, -1, 0, 2)).toBeCloseTo(1, 5);
    expect(w.hit.mat).toBe(MATERIALS.concrete);
    expect(MATERIALS.pad.grip).toBeLessThan(MATERIALS.concrete.grip);
  });
});

describe('every parked vehicle is its own rigid body', () => {
  it('reads its numbers from LINEUP_SPEC, falling back to class estimates', () => {
    const semi = LINEUP_SPEC.find((v) => v.id === 'semi'), cab = LINEUP_SPEC.find((v) => v.id === 'cab');
    expect(parkedPhysics({ ...cab, mass: 1234 }).mass).toBe(1234);
    expect(parkedPhysics(semi).mass).toBeGreaterThan(4 * parkedPhysics(cab).mass);
    const w = createWorld(LINEUP);
    for (const b of w.bodies) {
      const ph = parkedPhysics(b.spec);
      expect(b.rb.mass()).toBeCloseTo(ph.mass, 0);
      expect(b.rb.localCom().y).toBeCloseTo(ph.cgh, 4);
      const I = b.rb.principalInertia();
      expect(Math.max(I.x, I.y, I.z)).toBeCloseTo(Math.max(ph.inertia.roll, ph.inertia.yaw, ph.inertia.pitch), -1);
    }
  });
  it('parked, it costs nothing: asleep where the course put it until something touches it', () => {
    const w = createWorld(LINEUP);
    tick(w, 480);
    for (const b of w.bodies) { expect(b.rb.isSleeping()).toBe(true); expect(b.cy).toBe(0); }
  });
  it('woken, it stands on four springs carrying its weight, and falls back asleep', () => {
    const w = createWorld(LINEUP), b = w.bodies[0];
    b.rb.wakeUp();
    tick(w, 240);
    const total = b.wheels.reduce((a, x) => a + x.load, 0);
    expect(total / (b.mass * G)).toBeCloseTo(1, 1);
    expect(Math.abs(b.cy)).toBeLessThan(0.002);
    tick(w, 960);
    expect(b.rb.isSleeping()).toBe(true);
  });
  it('its suspension rings at its ride frequency (1.3 Hz car, 1.8 Hz tractor, ζ 0.3)', () => {
    for (const i of [0, 2]) {
      const w = createWorld(LINEUP), b = w.bodies[i];
      const p = b.rb.translation();
      b.rb.setTranslation({ x: p.x, y: p.y + 0.05, z: p.z }, true);
      let prev = 0.05;
      const cross = [];
      for (let t = 0; t < 960; t++) { tick(w); if ((prev > 0) !== (b.cy > 0) && t > 1) cross.push(t); prev = b.cy; }
      const fd = 1 / ((2 * (cross[2] - cross[1])) / 240);
      const expected = b.phys.rideHz * Math.sqrt(1 - b.phys.damping * b.phys.damping);
      expect(Math.abs(fd / expected - 1)).toBeLessThan(0.05);
    }
  });
  it('shoved sideways on its parked tyres, it slows at μ·g', () => {
    const w = createWorld(LINEUP), b = w.bodies[0];
    tick(w, 2);
    b.rb.setLinvel({ x: 0, y: 0, z: 3 }, true);
    tick(w, 1);
    const v0 = b.vz;
    tick(w, 48);
    const decel = (v0 - b.vz) / (48 / 240);
    expect(Math.abs(decel / (PARK_MU * G) - 1)).toBeLessThan(0.05);
  });
  // Tipped about the tyres on one side and let go: below its static stability angle (atan of half
  // the track over the CoM height) it drops back onto its wheels; well past it, it goes over. The
  // springs on the low side compress under the whole weight, so the real threshold sits below the
  // rigid SSF angle (as tilt-table tests find: tilt-table ratio < SSF).
  it('tipped below its static stability angle it rocks back; past it, it rolls over', () => {
    const tip = (deg) => {
      const w = createWorld(LINEUP), b = w.bodies[0];
      const th = (deg * Math.PI) / 180, P = Math.max(...b.phys.corners.map((c) => c.z));
      b.rb.setRotation({ x: Math.sin(th / 2), y: 0, z: 0, w: Math.cos(th / 2) }, true);
      b.rb.setTranslation({ x: b.cx, y: P * Math.sin(th), z: b.cz + P - P * Math.cos(th) }, true);
      tick(w, 720);
      return upY(b);
    };
    const ph0 = parkedPhysics(LINEUP_SPEC[0]);
    const ssf = (Math.atan(Math.max(...ph0.corners.map((c) => c.z)) / ph0.cgh) * 180) / Math.PI;
    expect(ssf).toBeGreaterThan(55);                  // a floor-battery sedan: hard to roll
    expect(tip(0.6 * ssf)).toBeGreaterThan(0.99);
    expect(tip(ssf + 8)).toBeLessThan(0.5);
  });
  it('a body shoved into its neighbour shoves it in turn, and never passes through it', () => {
    const w = createWorld(LINEUP), [a, b] = w.bodies;
    tick(w, 2);
    a.rb.setLinvel({ x: 0, y: 0, z: 6 }, true);
    tick(w, 240);
    expect(b.cz - LINEUP.boxes[1].cz).toBeGreaterThan(0.05);
    expect(b.cz - b.hz).toBeGreaterThan(a.cz + a.hz - 0.05);
  });
});

describe('the roadster\'s own force models', () => {
  it('tyre curves: longitudinal peak at κ ≈ 0.10, lateral at α ≈ 8°, both at D = μ·Fz, falling past it', () => {
    const D = SPEC.tyreMu * 6000;
    let kPeak = 0, fPeak = 0, aPeak = 0, yPeak = 0;
    for (let k = 0; k <= 0.5; k += 0.001) { const f = tyreFx(D, k); if (f > fPeak) { fPeak = f; kPeak = k; } }
    for (let a = 0; a <= 0.5; a += 0.001) { const f = -tyreFy(D, a); if (f > yPeak) { yPeak = f; aPeak = a; } }
    expect(kPeak).toBeGreaterThan(0.08); expect(kPeak).toBeLessThan(0.13);
    expect((aPeak * 180) / Math.PI).toBeGreaterThan(6.5); expect((aPeak * 180) / Math.PI).toBeLessThan(10);
    expect(fPeak / D).toBeCloseTo(1, 3); expect(yPeak / D).toBeCloseTo(1, 3);
    expect(tyreFx(D, 0.4)).toBeLessThan(0.95 * D);              // past the peak the tyre slides
    expect(tyreFy(D, -0.05)).toBeGreaterThan(0);                 // the force opposes the slip
    // Cornering stiffness at the origin ≈ B·C·D.
    expect(-tyreFy(D, 1e-4) / 1e-4 / D).toBeCloseTo(16 * 1.35, 0);
  });
  it('the car\'s springs: static sag and heave frequency match their rates', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    for (let i = 0; i < 480; i++) step(s, newInput());
    const y0 = s.pos.y, m = CAR.dryMass + s.air;
    s.pos.y += 0.03;
    const ys = [];
    for (let i = 0; i < 240; i++) { step(s, newInput()); ys.push(s.pos.y - y0); }
    // Total heave rate 4 × 150 kN/m (rated per axle load), damping 4 × 9.5 kN·s/m.
    const k = 600000, c = 38000, wn = Math.sqrt(k / m), zeta = c / (2 * Math.sqrt(k * m)), wd = wn * Math.sqrt(1 - zeta * zeta);
    const first = ys.findIndex((y) => y < 0) / 240;
    // From rest displaced, the first crossing of equilibrium is at (π − atan(√(1−ζ²)/ζ)) / ω_d.
    const expected = (Math.PI - Math.atan(Math.sqrt(1 - zeta * zeta) / zeta)) / wd;
    expect(Math.abs(first / expected - 1)).toBeLessThan(0.15);
  });
  it('a parked car under the roadster\'s tyres carries it: parked on a roof, the roof sinks on its springs', () => {
    const s = createVehicle('lineup');
    const b = s.world.bodies[2];                         // the semi: its roof is long enough across
    s.pos.x = b.cx; s.pos.z = b.cz; s.pos.y = b.h + SPEC.comHeight + 0.05;
    s.quat.y = Math.SQRT1_2; s.quat.w = Math.SQRT1_2;    // along the semi's length
    for (let i = 0; i < 720; i++) step(s, { ...newInput(), brake: 1 });
    expect(s.grounded).toBe(4);
    expect(s.pos.y).toBeGreaterThan(b.h);
    const sink = -b.cy, k = b.wheels.reduce((a, x) => a + x.k, 0);   // 2.45 t more on its springs
    expect(Math.abs(sink / (((CAR.dryMass + s.air) * G) / k) - 1)).toBeLessThan(0.25);
    expect(upY(b)).toBeGreaterThan(0.98);
  });
  it('the reference flights touch nothing they shouldn\'t: the row sleeps through a clean Show', () => {
    const run = createRun('show'), ap = createAutopilot('show');
    while (run.phase !== 'done') stepRun(run, ap(run));
    for (const b of run.car.world.bodies) { expect(b.moved).toBe(false); expect(b.cy).toBe(0); }
  });
});
