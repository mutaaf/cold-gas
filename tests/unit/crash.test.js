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
// The reference with LAND never pressed after the release: since SIM_VERSION 14 LAND reads the
// roofs below and sets down over the row at a walking pace, so a crash onto the row is one flown
// without it.
const noLand = (course, opts) => {
  const ap = createAutopilot(course, opts);
  return (run) => { const inp = ap(run); if (run.phase === 'air') inp.level = 0; return inp; };
};
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
  const slow = fly('show', noLand('show', { carry: 7.5 }));
  it('letting go at 7.5 m/s off the lip and never pressing LAND drops the car onto the row: hits on a parked body, then the ground', () => {
    expect(slow.t.contact).toBe(true);
    const hits = kinds(slow.impacts, HIT);
    expect(hits.some((e) => e[4] >= 0)).toBe(true);        // a parked vehicle
    expect(hits.some((e) => e[4] === -1)).toBe(true);      // the concrete
    for (const e of events(slow.impacts)) {
      expect(Math.hypot(e[8], e[9], e[10])).toBeCloseTo(1, 4);   // unit normals
      expect(e[11]).toBeGreaterThan(0);
    }
    const ticks = events(slow.impacts).map((e) => e[0]);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));     // in time order
    expect(Math.max(...ticks)).toBeLessThanOrEqual(slow.tick);
  });
  it('the crash replays bit-exactly from its input log, events included', () => {
    const re = simulate(slow.inputLog, 'show');
    expect(re.tick).toBe(slow.tick);
    expect(re.car.pos).toEqual(slow.car.pos);
    expect(Array.from(re.car.crush)).toEqual(Array.from(slow.car.crush));
    expect(events(re.impacts)).toEqual(events(slow.impacts));
    expect(scoreRun(re.t)).toEqual(scoreRun(slow.t));
  });
  // Too low over the row, two rolls asked for: the car's side clips a parked body, it grinds along
  // the roofs, its bodywork folds (and Assist rights it: where it ends is chaotic, so not pinned).
  const clip = fly('lineup', { speed: 9, apex: 3.2, rolls: 2 });   // (3.8 before SIM_VERSION 15's later brake)
  it('a hard clip: hits a parked body side-on, grinds, folds the bodywork, and replays bit-exactly', () => {
    expect(clip.t.contact).toBe(true);
    expect(kinds(clip.impacts, HIT).some((e) => e[2] === PART.side && e[4] >= 0)).toBe(true);
    expect(kinds(clip.impacts, SCRAPE).some((e) => e[2] === PART.roof || e[2] === PART.side)).toBe(true);   // grinds on its side or roof
    expect(Math.max(...clip.car.crush)).toBeGreaterThan(0.05);
    const re = simulate(clip.inputLog, 'lineup');
    expect(re.tick).toBe(clip.tick);
    expect(re.car.quat).toEqual(clip.car.quat);
    expect(events(re.impacts)).toEqual(events(clip.impacts));
    expect(re.car.world.bodies.map((b) => [b.cx, b.cy, b.cz, b.qw])).toEqual(clip.car.world.bodies.map((b) => [b.cx, b.cy, b.cz, b.qw]));
    expect(scoreRun(re.t)).toEqual(scoreRun(clip.t));
  });
  it('a tyre slam and a slide are events too', () => {
    const drop = fly('lineup', noLand('lineup', {}));   // the kickflip with no brake: down on its wheels hard
    expect(kinds(drop.impacts, WHEEL).length).toBeGreaterThan(0);
    expect(kinds(drop.impacts, SCRAPE).length).toBeGreaterThan(0);
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
    const run = fly('show', () => ({ ...newInput(), assist: 0, throttle: 1, fan: 1 }));   // Pro: Assist's crawl limiter would hold it on the curl
    const imp = run.impacts;
    expect(imp.tick.length).toBe(IMPACT_CAP);
    expect(imp.count).toBeLessThanOrEqual(IMPACT_CAP);
    expect(run.t.flipped).toBe(true);
  });
});

// The damage sensor (src/sim/damage.js): clean runs are clean, crashes cost the right zones, the
// judges mark it, a wreck is a wreck, and it all replays exactly.
import { createDamage, updateDamage, ZONES } from '../../src/sim/damage.js';
import { WRECK_PCT } from '../../src/sim/judge.js';
describe('damage sensor', () => {
  it('a clean reference run stays ≥ 98 % intact', () => {
    for (const course of ['show', 'wall', 'lineup']) expect(fly(course).t.damage.pct).toBeLessThanOrEqual(2);
  });
  it('dropping onto the row damages the car and the Integrity mark, and replays exactly', () => {
    const r = fly('show', noLand('show', { carry: 3 }));   // far too little carry, no brake: down onto the row hard
    expect(r.t.contact).toBe(true);
    expect(r.t.damage.pct).toBeGreaterThan(15);
    const card = scoreRun(r.t);
    expect(card.categories.damage).toBeLessThan(9);
    expect(card.facts.damagePct).toBe(r.t.damage.pct);
    const re = simulate(r.inputLog, 'show');
    expect(re.t.damage).toEqual(r.t.damage);
  });
  it('a 14 m/s head-on hit writes the car off; a 5 m/s knock costs ≈13 %', () => {
    const fake = (speed) => ({ impacts: { count: 1, kind: [0], part: [1], probe: [0], speed: [speed], crush: [0], tick: [10] } });
    const hard = updateDamage(createDamage(), fake(14), []), soft = updateDamage(createDamage(), fake(5), []);
    expect(hard.zones[ZONES.indexOf('nose')]).toBe(100);
    expect(hard.total).toBeGreaterThanOrEqual(WRECK_PCT);
    expect(soft.zones[ZONES.indexOf('nose')]).toBeCloseTo(12.8, 0);
  });
});

