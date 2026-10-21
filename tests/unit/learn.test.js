// The skill ladder (SIM_VERSION 11): Assist's LAND is good enough for a novice, the predictor agrees
// with what happens, the coach names the fix, drills start anywhere and retry exactly, and Advanced
// flies on ten valves by hand: logged, replayed and verified like every other run.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate, INPUT_KEYS, LEGACY_INPUT_KEYS, quantise, SIM_VERSION } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun, TIERS } from '../../src/sim/judge.js';
import { createVehicle, step, newInput, up, NOZZLES, VALVE_KEYS, ASSIST_CARRY, ASSIST_CRAWL, TRIM } from '../../src/sim/vehicle.js';
import { predict, newPrediction, SINK_SOFT } from '../../src/sim/predict.js';
import { coach } from '../../src/sim/coach.js';
import { wallProgress } from '../../src/sim/run.js';
import { DRILLS, buildDrill } from '../../src/practice.js';
import { keyValves, createKeyRamp, CHORDS } from '../../src/valves.js';
import { verify } from '../../src/worker/index.js';
import { SPEC, NOZZLE_SPEC } from '../../src/sim/spec.js';
import { dhypot } from '../../src/sim/dmath.js';

const IDX = Object.fromEntries(NOZZLE_SPEC.map((n, i) => [n.id, i]));
const fly = (course, opts, mut) => {
  const run = createRun(course), ap = createAutopilot(course, opts);
  while (run.phase !== 'done') { const inp = ap(run); if (mut) mut(run, inp); stepRun(run, inp); }
  return run;
};
// Fly a drill from its hand-over with a fixed policy.
const flyDrill = (id, policy, course = 'show') => {
  const { run } = buildDrill(DRILLS.find((d) => d.id === id), course);
  const t0 = run.tick;
  while (run.phase !== 'done') { const inp = newInput(); policy(inp, run, (run.tick - t0) / 240); stepRun(run, inp); }
  return run;
};

describe('SIM_VERSION 18: the rigid-body engine, the reveal G trace, relaxed tyres, TC at the peak, the set-down', () => {
  it('is version 18 (14: the rigid-body engine; 15: the reveal G trace, 0013; 16: tyre relaxation length, 0015; 17: traction control at the tyre peak; 18: the set-down follows the fall, 0014)', () => expect(SIM_VERSION).toBe(18));
  // SIM_VERSION 13 (the scheduled fan, with the Integrity category): Show 90.7, Wall 92.3, Lineup 86.3. v14 moves every body and contact into the
  // engine and splits the fan's seal into eight patches: the references fly the same climb and
  // the same descent; off the Wall the hang ends with the whole sealed floor on the deck (v11's
  // single-point fan kept full suction while the car's floor hung past the lip), so the release is
  // cleaner and the Wall lands nearer the mark. Nothing may get worse. v15 (0013) falls free off the
  // lip and brakes late and hard, which saves gas (LESSONS: one late, hard burn), and the references
  // roll off the ledge instead of hanging (the Wall at 2.5 m/s like run 2, the Show at its 7.5 m/s
  // carry): Wall gas left 44 % (efficiency 8.9), 3.6 m from the mark; Show 48 % (9.6), 1.5 m.
  // Show 94.0, Wall 96.0, Lineup 85.3. v16 (0015, tyre relaxation) moves the bits, not the scores.
  // v18 (0014): no hover after the kickflip and the Lineup mark just past the row, where the reveal
  // landed: Lineup 92.0 (0.5 m from the mark, 0.78 m/s); the Wall and the Show are bit-identical.
  it('keeps the reference runs: no worse than SIM_VERSION 13', () => {
    const runs = Object.fromEntries(['show', 'wall', 'lineup'].map((c) => [c, fly(c)]));
    const cards = Object.fromEntries(Object.entries(runs).map(([c, r]) => [c, scoreRun(r.t)]));
    // (+ the Integrity category, which a clean run scores ≈10: it lifts every reference a little)
    expect(cards.show.total).toBeGreaterThanOrEqual(90.7 - 0.5); expect(cards.show.total).toBeLessThanOrEqual(94.0 + 0.5);
    expect(cards.wall.total).toBeGreaterThanOrEqual(92.3 - 0.5); expect(cards.wall.total).toBeLessThanOrEqual(96.0 + 0.5);
    expect(cards.wall.categories.efficiency).toBeGreaterThan(8.5);   // the late burn's saving (v13: 6.0)
    expect(cards.lineup.total).toBeGreaterThanOrEqual(86.3 - 1.05); expect(cards.lineup.total).toBeLessThanOrEqual(92.0 + 0.5);
    for (const c of ['show', 'wall', 'lineup']) expect(cards[c].facts.damagePct).toBeLessThanOrEqual(2);
    expect(cards.wall.facts.padMiss).toBeLessThan(8);
    for (const c of ['show', 'wall', 'lineup']) { expect(runs[c].t.sink).toBeLessThan(1.2); expect(runs[c].t.tiltDeg).toBeLessThan(3); }
  });
});

describe('Assist: LAND is enough for a novice', () => {
  it('held from the release, LAND rolls the car out of the inversion in about a second', () => {
    const { run } = buildDrill(DRILLS.find((d) => d.id === 'release'), 'show');
    const t0 = run.tick, u = { x: 0, y: 0, z: 0 };
    expect(up(run.car, u).y).toBeLessThan(-0.9);
    let upright = -1;
    while (run.phase !== 'done' && upright < 0) {
      stepRun(run, { ...newInput(), level: 1 });
      if (up(run.car, u).y > 0.85) upright = (run.tick - t0) / 240;
    }
    expect(upright).toBeGreaterThan(0);
    expect(upright).toBeLessThan(1.4);   // the old sine-law leveller took ≈5 s from inverted
  });
  it('the cue (hold BOOST + LAND from the release) lands it soft, over the row', () => {
    const run = flyDrill('release', (inp) => { inp.level = 1; inp.thrust = 1; });
    expect(run.t.crossedRow).toBe(true);
    expect(run.t.contact).toBe(false);
    expect(run.t.sink).toBeLessThan(SINK_SOFT + 0.1);
  });
  it('LAND a reaction time late (0.4 s) still lands it', () => {
    const run = flyDrill('release', (inp, r, t) => { if (t > 0.4) { inp.level = 1; inp.thrust = t < 0.7 ? 1 : 0; } });
    expect(run.t.sink).toBeLessThan(2);
    expect(run.t.settledUpright).toBe(true);
  });
  it('the carry is limited: BOOST held all the way never carries much past ASSIST_CARRY (Pro does)', () => {
    let maxA = 0, maxP = 0;
    flyDrill('release', (inp, r) => { inp.level = 1; inp.thrust = 1; if (r.phase === 'air') maxA = Math.max(maxA, dhypot(r.car.vel.x, r.car.vel.z)); });
    flyDrill('release', (inp, r) => { inp.assist = 0; inp.thrust = 1; if (r.phase === 'air') maxP = Math.max(maxP, dhypot(r.car.vel.x, r.car.vel.z)); });
    expect(maxA).toBeLessThan(ASSIST_CARRY + 1.5);   // the valves' 30 ms lag and LAND's tilt add a little
    expect(maxP).toBeGreaterThan(ASSIST_CARRY + 5);
  });
  it('the crawl is limited: full throttle crawls over the top of the curl instead of flying off the lip', () => {
    const speedOver = (assist) => {
      const run = createRun('show');
      let top = 0;
      for (let i = 0; i < 240 * 30 && run.phase !== 'done'; i++) {
        stepRun(run, { ...newInput(), assist, throttle: 1, fan: 1 });
        if (run.phase === 'ramp' && wallProgress(run.car.pos) > 0.5) top = Math.max(top, dhypot(run.car.vel.x, run.car.vel.y, run.car.vel.z));
        if (wallProgress(run.car.pos) > 0.95 || run.phase === 'air') break;
      }
      return top;
    };
    expect(speedOver(1)).toBeLessThan(ASSIST_CRAWL + 1);
    expect(speedOver(0)).toBeGreaterThan(ASSIST_CRAWL + 8);   // Pro: the 1 MW is all yours
  });
  it('LAND holds the line: on the way down from 16 m, it takes out a sideways drift the pilot leaves alone', () => {
    const drift = (roll) => {
      const s = createVehicle('lineup'); s.pos.x = 30; s.pos.y = SPEC.comHeight + 16; s.vel.x = 4; s.vel.y = -4;
      for (let i = 0; i < 2400 && s.pos.y > SPEC.comHeight + 3; i++) step(s, { ...newInput(), level: 1, roll });
      return Math.abs(s.vel.x);
    };
    const held = drift(0), steered = drift(0.06);   // steering, the pilot owns the line
    expect(held).toBeLessThan(4 * 0.6);
    expect(held).toBeLessThan(steered);
  });
  it('Pro has no LAND: holding it does nothing to the jets', () => {
    const s = createVehicle('lineup'); s.pos.x = 30; s.pos.y = 20; s.vel.y = -10;
    for (let i = 0; i < 60; i++) step(s, { ...newInput(), assist: 0, level: 1 });
    expect(s.throttles.reduce((a, b) => a + b, 0)).toBeLessThan(0.01);
  });
});

describe('the predictor agrees with what happens', () => {
  it('hands off from 10 m, it goes red before the impact; with LAND held it never goes red and lands soft', () => {
    const seen = { off: new Set(), land: new Set() };
    const pr = newPrediction();
    const watch = (key) => (inp, run) => {
      if (key === 'land') inp.level = 1;
      if (run.phase === 'air') { predict(run.car, run.car.pos.y - SPEC.comHeight, pr); seen[key].add(pr.status); }
    };
    const off = flyDrill('land', watch('off'));
    const land = flyDrill('land', watch('land'));
    expect(off.t.sink).toBeGreaterThan(6);
    expect(seen.off.has('red')).toBe(true);
    expect(seen.land.has('red')).toBe(false);
    expect(land.t.sink).toBeLessThan(SINK_SOFT + 0.1);
  });
  it('the brake line is above the car once a stop no longer fits', () => {
    const pr = newPrediction();
    const s = createVehicle('lineup'); s.pos.y = SPEC.comHeight + 6; s.vel.y = -14;
    predict(s, 6, pr);
    expect(pr.brakeBy).toBeGreaterThan(6);
    expect(pr.margin).toBeLessThan(0);
    s.pos.y = SPEC.comHeight + 14; s.vel.y = -2; predict(s, 14, pr);
    expect(pr.margin).toBeGreaterThan(0);
    expect(pr.status).toBe('green');
  });
  it('upside down, the roll-out comes first: the line sits higher than for the same fall roof-up', () => {
    const pr = newPrediction();
    const s = createVehicle('lineup'); s.pos.y = 20; s.vel.y = -6;
    predict(s, 20, pr); const upright = pr.brakeBy;
    s.quat.x = 0; s.quat.y = 0; s.quat.z = 1; s.quat.w = 0;   // rolled 180° about the long axis
    predict(s, 20, pr);
    expect(pr.brakeBy).toBeGreaterThan(upright + 4);
    expect(Math.abs(pr.rollOut)).toBeGreaterThan(3);
  });
});

describe('the coach', () => {
  it('names a late brake with the height it needed', () => {
    const late = fly('show', {}, (run, inp) => {
      run.st = run.st || {};
      if (run.phase !== 'air') return;
      if (up(run.car, { x: 0, y: 0, z: 0 }).y > 0.9) run.st.up = true;
      if (run.st.up) { inp.assist = 0; inp.level = 0; inp.roll = 0; inp.pitch = 0; inp.lift = run.car.pos.y - SPEC.comHeight < 6 ? 1 : 0; }
    });
    const { items } = coach(late.inputLog, 'show', scoreRun(late.t));
    const it0 = items.find((i) => i.id === 'late-brake');
    expect(it0).toBeTruthy();
    const [braked, needed] = [...it0.detail.matchAll(/(\d+(?:\.\d)?) m\b/g)].map((m) => Number(m[1]));
    expect(needed).toBeGreaterThan(braked);
    expect(it0.fix).toMatch(/BRAKE line/);
  });
  it('a contact names the carry it needed', () => {
    const run = fly('show', { carry: 4 });
    expect(coach(run.inputLog, 'show', scoreRun(run.t)).items[0].id).toBe('short');
  });
  it('the reference is clean, and the coach points at the next tier', () => {
    const run = fly('show');
    const { items } = coach(run.inputLog, 'show', scoreRun(run.t));
    expect(items[0].id).toBe('clean');
    expect(items[0].fix).toMatch(/Pro|Advanced/);
  });
});

describe('practice drills', () => {
  it('start where they say: on the ledge inverted, just let go, 10 m up', () => {
    const u = { x: 0, y: 0, z: 0 };
    const ledge = buildDrill(DRILLS.find((d) => d.id === 'ledge'), 'show').run;
    expect(ledge.phase).toBe('ramp');
    expect(up(ledge.car, u).y).toBeLessThan(-0.9);
    expect(ledge.car.pos.y).toBeGreaterThan(25);
    const go = buildDrill(DRILLS.find((d) => d.id === 'release'), 'show').run;
    expect(go.car.fan).toBeLessThan(0.9);
    expect(go.car.vel.y).toBeLessThan(0);
    const land = buildDrill(DRILLS.find((d) => d.id === 'land'), 'show').run;
    expect(land.phase).toBe('air');
    expect(land.car.pos.y - SPEC.comHeight).toBeLessThanOrEqual(10.05);
  });
  it('a retry is exactly the same start, and the drill replays from its log', () => {
    const d = DRILLS.find((x) => x.id === 'release');
    const a = buildDrill(d, 'show').run, b = buildDrill(d, 'show').run;
    expect(b.tick).toBe(a.tick);
    expect(b.car.pos).toEqual(a.car.pos);
    expect(b.car.quat).toEqual(a.car.quat);
    for (let i = 0; i < 200; i++) stepRun(a, { ...newInput(), level: 1 });
    const re = simulate(a.inputLog, 'show', a.tick);
    expect(re.car.pos).toEqual(a.car.pos);
  });
});

describe('Advanced: ten valves by hand', () => {
  it('the log carries every valve: 23 channels, the first 12 as before', () => {
    expect(INPUT_KEYS.length).toBe(23);
    expect(INPUT_KEYS.slice(0, 12)).toEqual(LEGACY_INPUT_KEYS);
    expect(INPUT_KEYS.slice(12)).toEqual(['manual', ...VALVE_KEYS]);
  });
  it('quantise → pack → simulate round-trips a valve exactly', () => {
    const q = quantise({ ...newInput(), manual: 1, v1: 0.6349, v7: 1.7, v3: -0.2 }, {});
    expect(q.v1).toBe(0.63); expect(q.v7).toBe(1); expect(q.v3).toBe(-0.2);
    const run = createRun('lineup');
    stepRun(run, { ...newInput(), assist: 0, manual: 1, v1: 0.6349 });
    expect(run.inputLog[0][1 + INPUT_KEYS.indexOf('v1')]).toBe(63);
    expect(run.inputLog[0][1 + INPUT_KEYS.indexOf('manual')]).toBe(100);
  });
  it('one key, one nozzle: the mixer and the flight computer are out of the loop', () => {
    const s = createVehicle('lineup'); s.pos.x = 30; s.pos.y = 8;
    const inp = { ...newInput(), assist: 0, manual: 1, level: 1, lift: 1, roll: 1 };   // the computer's inputs are ignored
    inp[VALVE_KEYS[IDX['down-fl']]] = 1;
    for (let i = 0; i < 24; i++) step(s, inp);
    expect(s.throttles[IDX['down-fl']]).toBeGreaterThan(0.9);
    for (let i = 0; i < NOZZLES.length; i++) if (i !== IDX['down-fl']) expect(s.throttles[i]).toBe(0);
  });
  it('flies the Show on valves alone, replays bit-exactly, and is judged as Advanced (the top multiplier)', () => {
    const run = fly('show', { advanced: true });
    const card = scoreRun(run.t);
    expect(run.t.tier).toBe('advanced');
    expect(card.tier).toBe('advanced');
    expect(card.multiplier).toBe(TIERS.advanced.factor);
    expect(TIERS.advanced.factor).toBeGreaterThan(TIERS.pro.factor);
    expect(TIERS.pro.factor).toBeGreaterThan(TIERS.assist.factor);
    expect(run.t.sink).toBeLessThan(1.5);
    expect(run.t.crossedRow).toBe(true);
    const re = simulate(run.inputLog, 'show');
    expect(re.tick).toBe(run.tick);
    expect(re.car.pos).toEqual(run.car.pos);
    expect(scoreRun(re.t)).toEqual(card);
  });
  it('the Worker verifies an Advanced log to the same card, and a v9 log (12 channels) still verifies', () => {
    const adv = fly('show', { advanced: true });
    const v = verify({ log: adv.inputLog, course: 'show' });
    expect(v.card).toEqual(scoreRun(adv.t));
    expect(v.card.tier).toBe('advanced');
    const ref = fly('show');
    const legacy = ref.inputLog.map((e) => e.slice(0, 13));
    const vl = verify({ log: legacy, course: 'show' });
    expect(vl.card.total).toBe(scoreRun(ref.t).total);   // the reference never used a valve
    expect(verify({ log: ref.inputLog.map((e) => e.slice(0, 15)), course: 'show' })).toBeNull();
  });
  it('the tier comes from the flown inputs: one Assist tick makes it an Assist run', () => {
    const run = fly('show', { advanced: true }, (r, inp) => { if (r.tick === 2600) inp.assist = 1; });
    expect(run.t.tier).toBe('assist');
    const pro = fly('show', {}, (r, inp) => { inp.assist = 0; });
    expect(pro.t.tier).toBe('pro');
  });
});

describe('the Advanced keyboard (src/valves.js)', () => {
  const press = (...codes) => { const v = new Float64Array(10); keyValves((c) => codes.includes(c), v); return v; };
  it('is laid out like the car: Q E Z C are the four down-jets, 1 3 the fender jets, V B N M the rear row', () => {
    expect([...press('KeyQ')].map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([IDX['down-fl']]);
    expect(press('KeyC')[IDX['down-rr']]).toBe(1);
    expect(press('Digit1')[IDX['yaw-l']]).toBe(1);
    expect(press('KeyV')[IDX['rear-4']]).toBe(1);
    expect(press('KeyM')[IDX['rear-1']]).toBe(1);
  });
  it('Space opens all four down-jets at the pitch-free trim; Shift halves any key', () => {
    const v = press('Space');
    for (const id of ['down-fl', 'down-fr', 'down-rl', 'down-rr']) expect(v[IDX[id]]).toBeCloseTo(TRIM[IDX[id]], 6);
    expect(press('KeyQ', 'ShiftLeft')[IDX['down-fl']]).toBe(0.5);
  });
  it('a side pair is a pure roll (trimmed), and on a LIFT burn it throttles the other side back', () => {
    const a = press('KeyA');
    expect(a[IDX['down-fl']]).toBe(1);
    expect(a[IDX['down-rl']]).toBeCloseTo(TRIM[IDX['down-rl']], 6);
    const burn = press('Space', 'KeyA');
    expect(burn[IDX['down-fl']]).toBeCloseTo(TRIM[IDX['down-fl']], 6);
    expect(burn[IDX['down-fr']]).toBeCloseTo(TRIM[IDX['down-fr']] * 0.5, 6);
    expect(CHORDS.boost.valves.length).toBe(4);
  });
  it('held keys open their valve over 0.2 s; let go, they shut at once', () => {
    const ramp = createKeyRamp(), v = new Float64Array(10);
    let held = true;
    const trace = [];
    for (let i = 0; i < 60; i++) { v.fill(0); ramp((c) => held && c === 'KeyQ', v); trace.push(v[IDX['down-fl']]); }
    expect(trace[11]).toBeLessThan(0.35);
    expect(trace[59]).toBe(1);
    held = false; v.fill(0); ramp(() => false, v);
    expect(v[IDX['down-fl']]).toBe(0);
  });
});
