// Crashes: the bodywork folds (elastic to yield, then plastic), every impact is an event the
// renderer keys off, and a crash replays bit-exactly from its input log, events and all.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { createVehicle, step, newInput, HULL, HULL_PART } from '../../src/sim/vehicle.js';
import { HIT, SCRAPE, WHEEL, CRUSH, PART, IMPACT_CAP } from '../../src/sim/impacts.js';

function fly(course, opts) {
  const run = createRun(course);
  const ap = typeof opts === 'function' ? opts : createAutopilot(course, opts);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
}
const events = (imp) => {
  const out = [];
  for (let i = 0; i < imp.count; i++) {
    out.push([imp.tick[i], imp.kind[i], imp.part[i], imp.probe[i], imp.body[i], imp.x[i], imp.y[i], imp.z[i], imp.nx[i], imp.ny[i], imp.nz[i], imp.speed[i], imp.crush[i]]);
  }
  return out;
};
const kinds = (imp, k) => events(imp).filter((e) => e[1] === k);

// Drop the car from 2 m onto the lineup's open concrete in a given attitude at a closing speed.
function drop(qx, qy, qz, qw, v) {
  const s = createVehicle('lineup');
  s.pos.x = 40; s.pos.z = 40; s.pos.y = 2;
  s.quat.x = qx; s.quat.y = qy; s.quat.z = qz; s.quat.w = qw;
  s.vel.y = -v;
  let rebound = -Infinity, touched = false, impact = 0;
  for (let i = 0; i < 288; i++) {
    const vy = s.vel.y;
    step(s, newInput());
    if (s.hullContact && !touched) { touched = true; impact = -vy; }
    if (touched) rebound = Math.max(rebound, s.vel.y);
  }
  return { s, e: rebound / impact, crush: Math.max(...s.crush) };
}

describe('bodywork: elastic to yield, then it folds and stays folded', () => {
  it('a roof-first drop crushes the roof and barely bounces (crash-test restitution, not a trampoline)', () => {
    const { s, e, crush } = drop(1, 0, 0, 0, 8);
    expect(crush).toBeGreaterThan(0.1);
    expect(crush).toBeLessThanOrEqual(0.35);
    expect(e).toBeLessThan(0.3);
    const roof = HULL_PART.indexOf(PART.roof);
    expect(s.crush[roof]).toBeGreaterThan(0.1);
    expect(kinds(s.impacts, CRUSH).some((ev) => ev[2] === PART.roof)).toBe(true);
  });
  it('a nose-first drop folds the nose', () => {
    const { s, crush } = drop(Math.SQRT1_2, 0, 0, Math.SQRT1_2, 10);
    expect(crush).toBeGreaterThan(0.1);
    expect(kinds(s.impacts, HIT)[0][2]).toBe(PART.nose);
  });
  it('the floor rides compliant: a car parked on its wheels never crushes anything', () => {
    const s = createVehicle('lineup'); s.pos.x = 30;
    for (let i = 0; i < 480; i++) step(s, newInput());
    expect(Math.max(...s.crush)).toBe(0);
    expect(s.impacts.count).toBe(0);
  });
  it('every hull probe knows which part of the body it is', () => {
    expect(HULL_PART.length).toBe(HULL.length);
    for (const p of [PART.floor, PART.nose, PART.tail, PART.side, PART.roof]) expect(HULL_PART).toContain(p);
  });
});

describe('impact events', () => {
  const carry5 = fly('show', { carry: 5 });
  it('letting go without boosting drops the car onto the row: hits on a parked body, then the ground', () => {
    expect(carry5.t.contact).toBe(true);
    const hits = kinds(carry5.impacts, HIT);
    expect(hits.some((e) => e[4] >= 0)).toBe(true);        // a parked vehicle
    expect(hits.some((e) => e[4] === -1)).toBe(true);      // the concrete
    for (const e of events(carry5.impacts)) {
      expect(Math.hypot(e[8], e[9], e[10])).toBeCloseTo(1, 4);   // unit normals
      expect(e[11]).toBeGreaterThan(0);
    }
    const ticks = events(carry5.impacts).map((e) => e[0]);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));     // in time order
    expect(Math.max(...ticks)).toBeLessThanOrEqual(carry5.tick);
  });
  it('the crash replays bit-exactly from its input log, events included', () => {
    const re = simulate(carry5.inputLog, 'show');
    expect(re.tick).toBe(carry5.tick);
    expect(re.car.pos).toEqual(carry5.car.pos);
    expect(Array.from(re.car.crush)).toEqual(Array.from(carry5.car.crush));
    expect(events(re.impacts)).toEqual(events(carry5.impacts));
    expect(scoreRun(re.t)).toEqual(scoreRun(carry5.t));
  });
  // Too low over the row: it clips the roofs and goes over (onto its side or roof: chaotic, so the
  // exact resting face isn't pinned).
  const roll = fly('lineup', { apex: 2.8 });
  it('a rollover: clips the row, goes over, and replays bit-exactly', () => {
    expect(roll.t.flipped).toBe(true);
    expect(kinds(roll.impacts, HIT).some((e) => e[2] === PART.side && e[4] >= 0)).toBe(true);
    expect(kinds(roll.impacts, SCRAPE).some((e) => e[2] === PART.roof || e[2] === PART.side)).toBe(true);   // grinds on its side or roof
    expect(Math.max(...roll.car.crush)).toBeGreaterThan(0.05);
    const re = simulate(roll.inputLog, 'lineup');
    expect(re.tick).toBe(roll.tick);
    expect(re.car.quat).toEqual(roll.car.quat);
    expect(events(re.impacts)).toEqual(events(roll.impacts));
    expect(scoreRun(re.t)).toEqual(scoreRun(roll.t));
  });
  it('a tyre slam and a slide are events too', () => {
    expect(kinds(carry5.impacts, WHEEL).length).toBeGreaterThan(0);
    expect(kinds(carry5.impacts, SCRAPE).length).toBeGreaterThan(0);
  });
  it('the reference runs stay clean: no crush, nothing harder than a skirt touching the ledge', () => {
    for (const course of ['show', 'wall', 'lineup']) {
      const run = fly(course);
      expect(Math.max(...run.car.crush)).toBe(0);
      expect(kinds(run.impacts, HIT).every((e) => e[2] === PART.floor && e[11] < 3)).toBe(true);
      expect(kinds(run.impacts, CRUSH).length).toBe(0);
    }
  });
  it('the buffer is fixed: a long slide never grows it', () => {
    const run = fly('show', () => ({ ...newInput(), throttle: 1, fan: 1 }));
    const imp = run.impacts;
    expect(imp.tick.length).toBe(IMPACT_CAP);
    expect(imp.count).toBeLessThanOrEqual(IMPACT_CAP);
    expect(run.t.flipped).toBe(true);
  });
});
