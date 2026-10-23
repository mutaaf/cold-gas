// Every object a player can see is a physical thing with its own mechanics (docs/OBJECTS.md): parked
// cars take a hit with momentum conserved, the launch complex is solid where it is drawn, the rocket's
// static fire holds down and blows a car off the pad, the ascent integrator obeys Tsiolkovsky, the
// loose props are bodies with a hard budget, and none of it costs the scored replays a thing.
import { describe, it, expect } from 'vitest';
import { createVehicle, step, newInput, massOf, DT } from '../../src/sim/vehicle.js';
import { createRun, stepRun, simulate, SIM_VERSION } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { LINEUP, SHOW, FIXTURES, fixturesOf } from '../../src/sim/courses.js';
import { siteBuilt, propPose, PROP_CAP, PROP_BUILDS, freeWorld } from '../../src/sim/world.js';
import { siteOf, siteFloor, toWorld, toLocal, siteSolids, PAD_Y, MOUNT_TOP, PLUME, TOWER_X, TOWER_W, SITE_RADIUS } from '../../src/sim/complex.js';
import { staticFire, fireClock, FIRE_SCHEDULE, ROCKET, LIFTOFF_MASS, MDOT1, G0, ascend, idealDeltaV, jetSpeed, JET } from '../../src/sim/rocket.js';
import { CONE, BARRIER, propBody, parkedBody } from '../../src/sim/props.js';
import { dexp, dlog, datan2 } from '../../src/sim/dmath.js';
import { quatFromYaw } from '../../src/sim/m3.js';
import { SPEC } from '../../src/sim/spec.js';
import { createArenaCourse } from '../../src/build/arena.js';
import { createObjectStore, composeCourse, pieceBody } from '../../src/build/objects.js';

const momentum = (c, bodies) => {
  const m = massOf(c), p = { x: m * c.vel.x, y: 0, z: m * c.vel.z };
  for (const b of bodies) { p.x += b.mass * b.vx; p.z += b.mass * b.vz; }
  return p;
};
const at = (c, x, y, z, yaw) => { c.pos.x = x; c.pos.y = y; c.pos.z = z; quatFromYaw(c.quat, yaw); };
const rolling = (c, v, yaw) => { c.vel.x = v * Math.sin(yaw); c.vel.z = v * Math.cos(yaw); for (const w of c.wheels) w.omega = v / SPEC.wheelRadius; };

describe('dexp and dlog (src/sim/dmath.js)', () => {
  it('match the platform to the last ulp or two, and use only + − × ÷', () => {
    for (let i = 0; i <= 2000; i++) {
      const x = -40 + (80 * i) / 2000;
      expect(Math.abs(dexp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(4e-16);
      const y = dexp(x / 2);
      expect(Math.abs(dlog(y) - Math.log(y))).toBeLessThan(1e-15 * Math.max(1, Math.abs(Math.log(y))));
    }
    expect(dexp(0)).toBe(1); expect(dlog(1)).toBe(0); expect(dexp(-800)).toBe(0); expect(dexp(800)).toBe(Infinity);
    expect(dlog(0)).toBe(-Infinity); expect(Number.isNaN(dlog(-1))).toBe(true);
  });
});

describe('parked vehicles take a hit with momentum conserved', () => {
  it('the Lineup: the roadster at 10 m/s into the sedan’s flank shares its momentum (within 3 %)', () => {
    const c = createVehicle('lineup'), w = c.world, sedan = w.bodies[0];
    // On the lane's axis, 6 m short of the first car, rolling at 10 m/s, no throttle, no brake.
    at(c, 0, SPEC.comHeight, LINEUP.boxes[0].minZ - 6, 0);
    rolling(c, 10, 0);
    const inp = newInput();
    let before = null, k = 0;
    for (; k < 240 * 2; k++) {
      const p0 = momentum(c, w.bodies);
      step(c, inp);
      if (c.obstacleContact) { before = p0; break; }
    }
    expect(before).not.toBeNull();
    // Three ticks for the contact to resolve (the parked tyres' friction over 12 ms is ≈ 1 % of it).
    for (let i = 0; i < 3; i++) step(c, inp);
    const after = momentum(c, w.bodies);
    expect(sedan.vz).toBeGreaterThan(1);                       // it was knocked
    expect(after.z).toBeGreaterThan(before.z * 0.97);
    expect(after.z).toBeLessThan(before.z * 1.01);
    // And the share is what an inelastic hit between these masses gives: v' ≈ m₁v/(m₁ + m₂).
    const vShared = before.z / (massOf(c) + sedan.mass);
    expect(sedan.vz).toBeGreaterThan(vShared * 0.6);
    expect(sedan.vz).toBeLessThan(vShared * 1.6);
  });
  it('the Sandbox’s parked car is the same body: knocked, it rolls on and slides to a stop on its locked tyres', () => {
    const store = createObjectStore(), course = composeCourse(createArenaCourse(), store);
    const o = store.addObject({ type: 'car', transform: { x: 0, y: 0, z: 20, yaw: Math.PI / 2, scale: 1 } });
    const body = pieceBody(o);
    expect(body.kind).toBe('parked');
    expect(body.vehicle.mass).toBe(1705);                       // the lineup's sedan (docs/VEHICLES.md)
    const c = createVehicle(course);
    at(c, 0, SPEC.comHeight, 8, 0);
    rolling(c, 12, 0);
    const inp = newInput();
    let p0 = null, hit = -1;
    for (let k = 0; k < 240 * 6; k++) {
      const pre = momentum(c, c.world.props);
      step(c, inp);
      if (hit < 0 && c.obstacleContact) { hit = k; p0 = pre; }
      if (hit >= 0 && k === hit + 3) {
        const p1 = momentum(c, c.world.props);
        expect(p1.z).toBeGreaterThan(p0.z * 0.97);
        expect(p1.z).toBeLessThan(p0.z * 1.01);
      }
    }
    const pose = propPose(c.world, o);
    expect(pose.cz).toBeGreaterThan(21);                        // shoved down the apron
    expect(Math.hypot(pose.vx, pose.vz)).toBeLessThan(0.5);     // and stopped by its own tyres
    expect(1 - 2 * (pose.qx * pose.qx + pose.qz * pose.qz)).toBeGreaterThan(0.95);   // upright
    freeWorld(c.world);
  });
});

describe('cones and barriers are light bodies, pooled, streamed and on a budget', () => {
  const lane = (n, type, z0, gap, extra = {}) => {
    const store = createObjectStore(), course = composeCourse(createArenaCourse(), store), list = [];
    for (let i = 0; i < n; i++) list.push(store.addObject({ type, transform: { x: 0, y: 0, z: z0 + i * gap, yaw: 0, scale: 1, ...extra } }));
    return { store, course, list };
  };
  it('their numbers: a 28-inch cone of 3.2 kg, a 34 kg empty barrier, scaled by s³', () => {
    expect(propBody(CONE).mass).toBe(3.2);
    expect(propBody(BARRIER).mass).toBe(34);
    expect(propBody(CONE, 2).mass).toBeCloseTo(25.6, 9);
    expect(parkedBody(0.5).vehicle.mass).toBeCloseTo(1705 / 8, 6);
    expect(CONE.com).toBeLessThan(CONE.h / 4);                  // the heavy base keeps it upright
  });
  it('a cone hit at 20 m/s off the nose’s quarter is thrown ahead, slides out, and goes to sleep; the car barely notices', () => {
    // (Square on, a 71 cm cone goes down under the splitter and is carried: the nose is 10 cm off the ground.)
    const { course, list } = lane(1, 'cone', 20, 0, { x: 0.6 });
    const c = createVehicle(course);
    at(c, 0, SPEC.comHeight, 5, 0);
    rolling(c, 20, 0);
    const inp = newInput();
    let peak = 0, vCar = 0;
    for (let k = 0; k < 240 * 10; k++) {
      // Through it, then on the brakes (or the car would plough it down the apron).
      if (k === 200) inp.brake = 1;
      step(c, inp);
      const p = propPose(c.world, list[0]);
      if (p) peak = Math.max(peak, Math.hypot(p.vx, p.vz));
      if (k === 240) vCar = c.vel.z;
    }
    const p = propPose(c.world, list[0]);
    expect(peak).toBeGreaterThan(19);                           // thrown at about the car's speed: 3 kg off a 1.4 t nose
    expect(p.cz).toBeGreaterThan(30);
    expect(p.asleep).toBe(true);                                // Rapier put it to sleep where it settled
    expect(vCar).toBeGreaterThan(17);
    freeWorld(c.world);
  });
  it('a barrier across the lane takes the hit and slides; the car keeps going', () => {
    const { course, list } = lane(1, 'barrier', 20, 0);
    const c = createVehicle(course);
    at(c, 0, SPEC.comHeight, 5, 0);
    rolling(c, 15, 0);
    const inp = newInput();
    for (let k = 0; k < 240 * 6; k++) step(c, inp);
    const p = propPose(c.world, list[0]);
    expect(p.cz).toBeGreaterThan(25);
    expect(c.pos.z).toBeGreaterThan(40);
    freeWorld(c.world);
  });
  it('the budget: at most PROP_CAP in the engine, the nearest; the rest pooled; a knocked one stays knocked', () => {
    const { course, list } = lane(120, 'cone', 2, 1.0);
    const c = createVehicle(course);
    at(c, 3, SPEC.comHeight, 0, 0);
    step(c, newInput());
    expect(c.world.props.length).toBe(PROP_BUILDS);               // at most PROP_BUILDS come in a tick
    for (let k = 0; k < Math.ceil(PROP_CAP / PROP_BUILDS); k++) step(c, newInput());
    expect(c.world.props.length).toBe(PROP_CAP);
    expect(c.world.props.every((p) => p.o.transform.z < 2 + PROP_CAP + 1)).toBe(true);
    // Knock the first one, drive away (it streams out to the pool), come back: it is where it was left.
    const first = list[0], b = c.world.free.props.get(first);
    b.rb.setLinvel({ x: 3, y: 0, z: 0 }, true);
    for (let k = 0; k < 240; k++) step(c, newInput());
    const left = { ...propPose(c.world, first) };
    expect(left.cx).toBeGreaterThan(0.3);
    at(c, 3, SPEC.comHeight, 400, 0); c.vel.x = c.vel.z = 0;
    for (let k = 0; k < 8; k++) step(c, newInput());
    expect(c.world.free.props.has(first)).toBe(false);
    expect([...c.world.free.pool.values()].reduce((a, p) => a + p.length, 0)).toBe(PROP_CAP);
    at(c, 3, SPEC.comHeight, 0, 0);
    for (let k = 0; k < 8; k++) step(c, newInput());
    const back = propPose(c.world, first);
    expect(back.cx).toBeCloseTo(left.cx, 4);
    expect(c.world.rw.bodies.len()).toBe(PROP_CAP + 1);          // reused from the pool: no new bodies
    freeWorld(c.world);
  });
});

describe('the stage’s fixtures are solid where they are drawn', () => {
  it('a Lineup floodlight pole and a Wall searchlight stop a car driven at them', () => {
    const P = FIXTURES.poles;
    for (const [course, x, z] of [['lineup', P.x, P.z0], ['wall', FIXTURES.searchlights.at[4][0], FIXTURES.searchlights.at[4][1]]]) {
      const c = createVehicle(course);
      at(c, x, SPEC.comHeight, z - 10, 0);
      rolling(c, 12, 0);
      const inp = newInput();
      for (let k = 0; k < 240 * 3; k++) step(c, inp);
      expect(c.pos.z).toBeLessThan(z);
      expect(Math.hypot(c.vel.x, c.vel.z)).toBeLessThan(4);
      freeWorld(c.world);
    }
    expect(fixturesOf('show').length).toBe(10);
    expect(fixturesOf('lineup').length).toBe(12);
  });
});

describe('the launch complex is solid where it is drawn', () => {
  const site = siteOf('show');
  const start = (lx, lz, faceLx, faceLz) => {
    const run = createRun('show'), c = run.car, p = toWorld(site, lx, 0, lz), f = toWorld(site, faceLx, 0, faceLz);
    at(c, p.x, PAD_Y + SPEC.comHeight + 0.05, p.z, Math.atan2(f.x - p.x, f.z - p.z));
    return run;
  };
  it('the drawn and the solid share one placement', () => {
    const s = siteOf('wall');
    expect(s).toBe(site);
    expect(siteOf('lineup').x).toBe(-260);
    expect(siteOf('sandbox')).toBeNull();
    const back = toLocal(site, ...Object.values(toWorld(site, 12, 3, -40)));
    expect(back.x).toBeCloseTo(12, 9); expect(back.z).toBeCloseTo(-40, 9);
    expect(siteSolids().length).toBeGreaterThan(25);
  });
  it('the reference runs never build it: the stunts replay as they did', () => {
    for (const course of ['show', 'wall', 'lineup']) {
      const run = createRun(course), ap = createAutopilot(course);
      let built = false;
      while (run.phase !== 'done') { stepRun(run, ap(run)); built ||= !!run.car.world.site?.cols.length; }
      expect(built).toBe(false);
    }
  });
  it('the car drives up the hardstand’s skirt onto the pad', () => {
    const run = start(110, 0, 0, 0), c = run.car;
    c.pos.y = SPEC.comHeight;
    for (let k = 0; k < 240 * 8 && run.phase !== 'done'; k++) stepRun(run, { throttle: k < 240 * 3 ? 0.6 : 0, brake: k >= 240 * 5 ? 1 : 0, assist: 1 });
    expect(siteBuilt(c.world)).toBe(true);
    const l = toLocal(site, c.pos.x, c.pos.y, c.pos.z);
    expect(Math.hypot(l.x, l.z)).toBeLessThan(66);
    expect(c.pos.y).toBeGreaterThan(PAD_Y + 0.2);
    expect(c.pos.y).toBeLessThan(PAD_Y + 0.7);
  });
  it('the pad is not the Wall: a car up on it stays in the drive phase (the run does not end as a landing)', () => {
    // A point on the pad on the Wall's side of z (its rule was z > 0.5 and y > 1.2, anywhere in x).
    // Inside the course's runout (z ≤ 40), facing back toward the pad's centre so it stays on it.
    let lx = 0, lz = 0;
    for (let x = -50; x <= 50; x += 10) for (let z = -50; z <= 50; z += 10) { const w = toWorld(site, x, 0, z).z; if (w > 8 && w < 25 && Math.hypot(x, z) < 55) { lx = x; lz = z; } }
    const run = start(lx, lz, 0, 0), c = run.car;
    expect(c.pos.z).toBeGreaterThan(0.5);
    for (let k = 0; k < 240 * 3; k++) stepRun(run, { throttle: k < 240 ? 0.4 : 0, brake: k >= 240 * 2 ? 1 : 0, assist: 1 });
    expect(c.pos.y).toBeGreaterThan(PAD_Y);
    expect(run.phase).toBe('drive');
  });
  it('the altimeter\'s floor: the pad, its skirt and the mount\'s deck, only from above', () => {
    const at = (lx, ly, lz) => { const p = toWorld(site, lx, 0, lz); return siteFloor('show', p.x, ly, p.z); };
    expect(at(30, 10, 0)).toBe(PAD_Y);
    expect(at(76, 10, 0)).toBeCloseTo(PAD_Y / 2, 6);          // halfway down the skirt (66 → 86 m)
    expect(at(120, 10, 0)).toBe(-Infinity);
    expect(at(0, MOUNT_TOP + 2, 0)).toBe(MOUNT_TOP);           // over the mount's deck
    expect(at(0, MOUNT_TOP - 3, 0)).toBe(PAD_Y);               // under it, in the trench's headroom
    expect(at(30, 1, 0)).toBe(-Infinity);                      // below the pad's top: not a floor
    expect(siteFloor('freedrive', 0, 10, 0)).toBe(-Infinity);
  });
  it('the strongback stops a car driven at it at 15 m/s', () => {
    const run = start(40, 0, 0, 0), c = run.car;
    let vMax = 0, hull = false;
    for (let k = 0; k < 240 * 7; k++) { stepRun(run, { throttle: k < 240 * 3 ? 1 : 0, assist: 1 }); vMax = Math.max(vMax, Math.hypot(c.vel.x, c.vel.z)); hull ||= c.hullContact; }
    expect(vMax).toBeGreaterThan(12);
    const l = toLocal(site, c.pos.x, c.pos.y, c.pos.z);
    // Still outside the tower's face (its +x side at TOWER_X + TOWER_W / 2), and stopped.
    expect(l.x).toBeGreaterThan(TOWER_X + TOWER_W / 2);
    expect(Math.hypot(c.vel.x, c.vel.z)).toBeLessThan(1);
    expect(hull).toBe(true);
  });
  it('the launch mount is a table on four columns: a column stops the car, the opening under the deck lets it through', () => {
    // At a column (local x 4.2): stopped short of it.
    const run = start(4.2, 60, 4.2, 0), c = run.car;
    for (let k = 0; k < 240 * 8; k++) stepRun(run, { throttle: k < 240 * 3 ? 1 : 0, assist: 1 });
    const l = toLocal(site, c.pos.x, c.pos.y, c.pos.z);
    expect(l.z).toBeGreaterThan(4.2 + 0.7);
    expect(Math.hypot(c.vel.x, c.vel.z)).toBeLessThan(2);
    // Down the middle: 3.4 m of headroom under the deck, over the trench (the flame's way through).
    const mid = start(0, 60, 0, 0);
    for (let k = 0; k < 240 * 5; k++) stepRun(mid, { throttle: k < 240 * 3 ? 1 : 0, assist: 1 });
    expect(toLocal(site, mid.car.pos.x, 0, mid.car.pos.z).z).toBeLessThan(-10);
  });
  it('a drive out to the pad replays to the same bits from its log (and is built in both)', () => {
    const run = createRun('show'), c = run.car, aim = toWorld(site, TOWER_X, 0, 0);
    // Steer for the strongback (+ steer is the driver's right) at up to 25 m/s, and hold the brake
    // wherever it ends up.
    for (let k = 0; k < 240 * 24 && run.phase !== 'done'; k++) {
      const hdg = datan2(2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y));
      let e = datan2(aim.x - c.pos.x, aim.z - c.pos.z) - hdg;
      e = e > Math.PI ? e - 2 * Math.PI : e < -Math.PI ? e + 2 * Math.PI : e;
      const v = Math.hypot(c.vel.x, c.vel.z);
      stepRun(run, { throttle: v < 25 && k < 240 * 14 ? 1 : 0, brake: k >= 240 * 14 ? 1 : 0, steer: Math.max(-1, Math.min(1, -2 * e)), assist: 1 });
    }
    const live = run.car;
    expect(siteBuilt(live.world)).toBe(true);
    expect(Math.hypot(live.pos.x - site.x, live.pos.z - site.z)).toBeLessThan(SITE_RADIUS + 60);
    const re = simulate(run.inputLog, 'show', run.tick);
    expect(re.car.pos.x).toBe(live.pos.x); expect(re.car.pos.z).toBe(live.pos.z); expect(re.car.quat.w).toBe(live.quat.w);
    expect(SIM_VERSION).toBe(26);
  });
});

describe('the rocket: static fire, hold-down, the jet, the ascent (src/sim/rocket.js)', () => {
  it('nine engines at 845 kN: 7.6 MN at full thrust, held down against its weight', () => {
    const f = staticFire(3);
    expect(f.level).toBe(1);
    expect(f.thrust).toBeCloseTo(9 * 845e3, 3);
    expect(f.mdot).toBeCloseTo(9 * MDOT1, 6);
    expect(MDOT1).toBeCloseTo(914e3 / (311 * G0), 9);
    // The burn so far is the integral of the flow: 9 engines, staggered 40 ms, ramped over 0.4 s.
    let integ = 0;
    for (let t = 0; t < 3; t += 1e-4) integ += staticFire(t + 5e-5).mdot * 1e-4;
    expect(f.burned).toBeCloseTo(integ, 0);
    expect(f.mass).toBeCloseTo(LIFTOFF_MASS - f.burned, 6);
    expect(f.holdDown).toBeCloseTo(f.thrust - f.mass * G0, 3);   // ≈ 2.4 MN on the clamps
    expect(f.holdDown).toBeGreaterThan(2.2e6);
    // At ignition the mount carries the weight; before the first engine is up the clamps carry nothing.
    const s = staticFire(0.01);
    expect(s.holdDown).toBe(0);
    expect(s.bearing).toBeCloseTo(s.weight - s.thrust, 3);
    // Staggered start, every engine lit by 0.32 s + 0.4 s; cut off over 0.6 s; nothing after.
    expect(staticFire(0.2).level).toBeLessThan(0.5);
    expect(staticFire(ROCKET.fire.len - 0.3).level).toBeCloseTo(0.5, 6);
    expect(staticFire(ROCKET.fire.len + 0.1).thrust).toBe(0);
  });
  it('fires on the range’s schedule: 20 s into a run, then every 40 s', () => {
    expect(fireClock(FIRE_SCHEDULE.first - 0.01)).toBe(-1);
    expect(fireClock(FIRE_SCHEDULE.first + 1)).toBeCloseTo(1, 9);
    expect(fireClock(FIRE_SCHEDULE.first + ROCKET.fire.len + 0.1)).toBe(-1);
    expect(fireClock(FIRE_SCHEDULE.first + FIRE_SCHEDULE.every + 2)).toBeCloseTo(2, 9);
  });
  it('the jet: momentum flux conserved as it spreads, nothing behind the exit or far off its axis', () => {
    const T = 9 * 845e3, hw = PLUME.halfWidth;
    for (const a of [5, 50, 200]) {
      // ∫ρU² dA over the profile = η·T at every distance.
      let J = 0;
      for (let r = 0.05; r < 150; r += 0.1) { const u = jetSpeed(T, a, r * r, hw); J += JET.rho * u * u * 2 * Math.PI * r * 0.1; }
      expect(J / (JET.eta * T)).toBeGreaterThan(0.99);
      expect(J / (JET.eta * T)).toBeLessThan(1.005);
    }
    expect(jetSpeed(T, -1, 0, hw)).toBe(0);
    expect(jetSpeed(0, 10, 0, hw)).toBe(0);
    expect(jetSpeed(T, 100, 100 * 100, hw)).toBe(0);
  });
  it('blows a car parked at the trench exit off the pad, and leaves one on the stage alone', () => {
    const site = siteOf('show');
    const run = createRun('show'), c = run.car, p = toWorld(site, 0, 0, PLUME.exit[2] - 12);
    at(c, p.x, PAD_Y + SPEC.comHeight + 0.05, p.z, 0);
    const stage = createRun('show');
    let push = 0, stagePush = 0;
    const t0 = Math.round(FIRE_SCHEDULE.first / DT);
    for (let k = 0; k < t0 + 240 * 4 && run.phase !== 'done'; k++) {
      stepRun(run, { brake: 1, assist: 1 });
      if (stage.phase !== 'done') { stepRun(stage, { brake: 1, assist: 1 }); stagePush = Math.max(stagePush, stage.car.world.site.push); }
      if (k === t0 - 1) expect(Math.hypot(c.pos.x - p.x, c.pos.z - p.z)).toBeLessThan(0.3);   // brakes held it till the fire
      push = Math.max(push, c.world.site.push);
    }
    // ≈ 190 kN at 12 m from the exit broadside (q ≈ 38 kPa): tonnes of force, the car is thrown.
    expect(push).toBeGreaterThan(1e5);
    const l = toLocal(site, c.pos.x, c.pos.y, c.pos.z);
    expect(PLUME.exit[2] - l.z).toBeGreaterThan(25);             // carried down the jet (along −z)
    expect(stagePush).toBe(0);
  });
  it('the ascent obeys Tsiolkovsky to the integrator’s precision (no drag, no gravity)', () => {
    const v = ascend({ drag: false, gravity: false, vacuum: true, kickSpeed: 1e9 });
    const m1 = LIFTOFF_MASS - ROCKET.stage1.propellant * (1 - ROCKET.stage1.reserve);
    expect(v.events.meco.m).toBeCloseTo(m1, 3);
    expect(v.events.meco.v / idealDeltaV(ROCKET.stage1.ispVac, LIFTOFF_MASS, m1)).toBeCloseTo(1, 9);
  });
  it('and flies like the class with them: Mach 1 near 50 s, max-Q ≈ 30–35 kPa near 12 km, MECO ≈ 70 km at ≈ 2.1 km/s', () => {
    const { events: e } = ascend();
    expect(e.mach1t).toBeGreaterThan(40); expect(e.mach1t).toBeLessThan(60);
    expect(e.maxQ).toBeGreaterThan(25e3); expect(e.maxQ).toBeLessThan(45e3);
    expect(e.maxQh).toBeGreaterThan(9e3); expect(e.maxQh).toBeLessThan(15e3);
    expect(e.meco.h).toBeGreaterThan(55e3); expect(e.meco.h).toBeLessThan(90e3);
    expect(e.meco.v).toBeGreaterThan(1.8e3); expect(e.meco.v).toBeLessThan(2.5e3);
    expect(e.seco.v).toBeGreaterThan(6.5e3);
  });
});

// Quiet, on an M1 Max: the Show replays at ≈ 0.04 ms a tick and the Sandbox's slalom at ≈ 0.07
// (docs/OBJECTS.md). The bars are ten times that and the best of three runs, so a loaded CI box
// passes and a real regression (an awake pile, a lost sleep, a rebuild a tick) doesn't.
describe('the budget: what the objects cost a tick (scripts/objects-bench.mjs measures it in full)', () => {
  const msPerTick = (fn) => { fn(); let best = Infinity; for (let r = 0; r < 3; r++) { const t0 = performance.now(); const n = fn(); best = Math.min(best, (performance.now() - t0) / n); } return best; };
  it('the Show reference replays (the Worker’s verify) under 0.4 ms a tick', () => {
    const run = createRun('show'), ap = createAutopilot('show');
    while (run.phase !== 'done') stepRun(run, ap(run));
    const ms = msPerTick(() => simulate(run.inputLog, 'show').tick);
    expect(ms).toBeLessThan(0.4);
  }, 60_000);
  it('the Sandbox with 6 parked cars, 30 cones and 10 barriers driven through: under 0.7 ms a tick', () => {
    const ms = msPerTick(() => {
      const store = createObjectStore(), course = composeCourse(createArenaCourse(), store);
      for (let i = 0; i < 6; i++) store.addObject({ type: 'car', transform: { x: i % 2 ? 1.2 : -1.2, y: 0, z: 20 + i * 9, yaw: Math.PI / 2, scale: 1 } });
      for (let i = 0; i < 30; i++) store.addObject({ type: 'cone', transform: { x: -3 + (i % 6) * 1.2, y: 0, z: 80 + Math.floor(i / 6) * 3, yaw: 0, scale: 1 } });
      for (let i = 0; i < 10; i++) store.addObject({ type: 'barrier', transform: { x: -4 + (i % 5) * 2, y: 0, z: 100 + Math.floor(i / 5) * 4, yaw: Math.PI / 2, scale: 1 } });
      const c = createVehicle(course), inp = newInput();
      inp.throttle = 1; inp.assist = 1;
      const n = 240 * 7;
      for (let k = 0; k < n; k++) step(c, inp);
      freeWorld(c.world);
      return n;
    });
    expect(ms).toBeLessThan(0.7);
  }, 120_000);
});
