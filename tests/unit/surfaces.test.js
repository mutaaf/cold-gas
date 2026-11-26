// 0340: the scored sets react to water and mud. Course data (courses.js `surfaces`) on the Show and the Lineup; a run at
// SURFACE_VERSION meets them, a run from before replays on the set as it was, to the same bits.
import { describe, it, expect } from 'vitest';
import { createRun, stepRun, simulate, SIM_VERSION, SURFACE_VERSION, MARK_VERSION, RUNUP_VERSION, simVersionOf, replayable, courseAt } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun } from '../../src/sim/judge.js';
import { newInput, createVehicle, step } from '../../src/sim/vehicle.js';
import { COURSES, MATERIALS, SHOW, LINEUP, WALL, dryCourse } from '../../src/sim/courses.js';
import { waterLevel, mudSink, tankWalls, NO_WATER } from '../../src/sim/surfaces.js';
import { packBytes, toB64url, decodeChallenge } from '../../src/challenge.js';
import { SURFACE_RUNS } from '../../scripts/vectors-lib.mjs';
import { localWords } from '../../src/panel.js';
import { boardCheck } from '../../src/worker/index.js';

const flyAuto = (course, v, opts = {}) => {
  const run = createRun(course, v), ap = createAutopilot(course, opts);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run;
};
const bits = (run) => [run.car.pos.x, run.car.pos.y, run.car.pos.z, run.car.quat.w, run.car.vel.x, run.car.vel.z, run.car.air, run.tick];

describe('surfaces: the data and the pure queries', () => {
  it('only the Show and the Lineup carry water and mud; the Wall is as it was', () => {
    expect(SHOW.surfaces.tanks.length).toBe(1);
    expect(SHOW.surfaces.mud.length).toBeGreaterThan(0);
    expect(LINEUP.surfaces.tanks.length).toBe(1);
    expect(LINEUP.surfaces.mud.length).toBeGreaterThan(1);
    expect(WALL.surfaces).toBeUndefined();
    // 0360: the Show and the Wall are scored at MARK_VERSION since; the Lineup was the surfaces' v33 until 0363's run-up
    // limit made it RUNUP_VERSION (its v33 runs still replay: lineup-runup.test.js).
    expect(simVersionOf('show')).toBe(MARK_VERSION);
    expect(simVersionOf('lineup')).toBe(RUNUP_VERSION);
    expect(simVersionOf('wall')).toBe(MARK_VERSION);
  });
  it('a v32 run on a wet set replays on the set as it was', () => {
    expect(courseAt('show', SIM_VERSION).surfaces).toBeNull();
    expect(courseAt('show').surfaces).toBe(SHOW.surfaces);
    expect(dryCourse('wall')).toBe(WALL);
    expect(replayable('lineup', 32) && replayable('lineup', 33) && replayable('show', MARK_VERSION)).toBe(true);
    // 0360: a v32/v33 Show or Wall card reads the old mark curve, so those runs are stale (judge-bullseye.test.js).
    expect(replayable('show', 31) || replayable('show', 32) || replayable('show', 33) || replayable('wall', 32)).toBe(false);
  });
  it('the water is inside the tank only, the mud deepest at its middle and nothing at its edge', () => {
    const k = SHOW.surfaces.tanks[0], m = SHOW.surfaces.mud[0];
    expect(waterLevel(SHOW.surfaces, (k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2)).toBe(k.level);
    expect(waterLevel(SHOW.surfaces, k.x1 + 0.01, (k.z0 + k.z1) / 2)).toBe(NO_WATER);
    expect(waterLevel(SHOW.surfaces, 0, SHOW.pad.z)).toBe(NO_WATER);
    expect(mudSink(SHOW.surfaces, m.x, m.z)).toBe(m.sink);
    expect(mudSink(SHOW.surfaces, m.x + m.rx * 0.999, m.z)).toBeLessThan(m.sink * 0.01);
    expect(mudSink(SHOW.surfaces, m.x + m.rx * 1.01, m.z)).toBe(-1);
    // Four walls round the water, none over it.
    const walls = tankWalls(k);
    expect(walls.length).toBe(4);
    for (const b of walls) expect(b[0] >= k.x0 && b[3] <= k.x1 && b[2] >= k.z0 && b[5] <= k.z1).toBe(false);
  });
  it('fair: the pads and the run\'s line stay dry, the tanks stand off to the side, the mud past the pads', () => {
    for (const c of [SHOW, LINEUP]) {
      const s = c.surfaces;
      for (let dz = -7.8; dz <= 7.8; dz += 0.6) for (let dx = -7.8; dx <= 7.8; dx += 0.6) {
        if (dx * dx + dz * dz > 7.8 * 7.8) continue;
        expect(waterLevel(s, c.pad.x + dx, c.pad.z + dz)).toBe(NO_WATER);
        expect(mudSink(s, c.pad.x + dx, c.pad.z + dz)).toBe(-1);
      }
      // A tank stands off the line the car flies and rolls out along (x = 0): only a flight 10 m wide of the mark meets it,
      // and its wall is 2 m+ clear of the painted pad.
      for (const k of s.tanks) {
        expect(k.x0 - k.wall).toBeGreaterThan(9);
        const dx = Math.max(k.x0 - k.wall - c.pad.x, 0), dz = Math.max(k.z0 - k.wall - c.pad.z, c.pad.z - (k.z1 + k.wall), 0);
        expect(Math.hypot(dx, dz)).toBeGreaterThan(7.8 + 1.5);
      }
    }
    // The Lineup's run-up line (x = 0, start to lift-off) never crosses its soft patch.
    for (let z = LINEUP.start.z; z < 0; z += 0.5) expect(mudSink(LINEUP.surfaces, 0, z)).toBe(-1);
  });
});

describe('surfaces: every old run keeps its bits', () => {
  it('the references fly the wet sets to the same bits as the dry ones (they never meet the water or the mud)', () => {
    for (const course of ['show', 'lineup']) {
      const wet = flyAuto(course, SURFACE_VERSION), dry = flyAuto(course, SIM_VERSION);
      expect(bits(wet)).toEqual(bits(dry));
      expect(scoreRun(wet.t).total).toBe(scoreRun(dry.t).total);
      expect(wet.t.splash).toBe(false);
      expect(dry.t.splash).toBeUndefined();   // a dry run's telemetry (and card) is what it always was
      expect('splash' in scoreRun(dry.t).facts).toBe(false);
    }
  });
  it('a v32 log replays on the set as it was, even where the set is wet now', () => {
    const r = SURFACE_RUNS.find((x) => x.name === 'splash-show-wide');
    const log = r.log();
    const old = simulate(log, 'show', undefined, null, SIM_VERSION), now = simulate(log, 'show');
    expect(old.t.splash).toBeUndefined();
    expect(now.t.splash).toBe(true);
    expect(bits(old)).not.toEqual(bits(now));
  });
});

describe('surfaces: the physics', () => {
  it('a flight wide of the mark ends in the tank: a splash-down, a float, a "Splash" from the panel', () => {
    const r = SURFACE_RUNS.find((x) => x.name === 'splash-show-wide');
    let maxWet = 0, minFlood = 1, finite = true;
    const run = simulate(r.log(), 'show', undefined, (rr) => {
      const c = rr.car;
      maxWet = Math.max(maxWet, c.wet); minFlood = Math.min(minFlood, c.flood);
      if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.angVel.x + c.angVel.y + c.angVel.z)) finite = false;
    });
    expect(finite).toBe(true);
    expect(run.t.splash).toBe(true);
    expect(run.t.endReason).toBe('splash');
    expect(run.t.splashSpeed).toBeGreaterThan(5);
    expect(maxWet).toBeGreaterThan(0.3);
    expect(minFlood).toBeLessThan(1);
    // It floats: the body rides higher than it sits on the slab (the tank's floor is the slab).
    expect(run.car.pos.y).toBeGreaterThan(0.5);
    const card = scoreRun(run.t);
    expect(card.verdict).toBe('Splash');
    expect(card.facts.crashed).toBe(true);
    expect(card.facts.splash).toBe(true);
    expect(card.facts.splashKmh).toBeGreaterThan(20);
    expect(localWords(card).headline).toBe('Splash');
    expect(card.total).toBeLessThanOrEqual(35);
  });
  it('the water floats a flooded car down and never blows up, however hard it goes in', () => {
    const c = createVehicle('show'), k = SHOW.surfaces.tanks[0];
    c.pos.x = (k.x0 + k.x1) / 2; c.pos.y = 25; c.pos.z = k.z1 - 4;
    c.vel.y = -30; c.vel.z = -3;
    c.angMom.x = 4000; c.angMom.z = -2500;
    const inp = newInput(); inp.assist = 0; inp.manual = 1;
    let entry = -1, maxAfter = 0, atOne = Infinity;
    for (let i = 0; i < 240 * 20; i++) {
      step(c, inp);
      expect(Number.isFinite(c.pos.y + c.vel.y + c.angVel.x)).toBe(true);
      if (c.splashTick >= 0 && entry < 0) entry = c.tick;
      const sp = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
      if (entry > 0) { maxAfter = Math.max(maxAfter, sp); if (c.tick === entry + 240) atOne = sp; }
    }
    // Flooded, it has settled on the tank's floor (the slab: on its wheels or, after a spin like this one, its roof), still.
    expect(c.pos.y).toBeLessThan(0.75);
    expect(c.wet).toBeGreaterThan(0.5);
    expect(Math.hypot(c.vel.x, c.vel.y, c.vel.z)).toBeLessThan(0.2);
    expect(entry).toBeGreaterThan(0);
    expect(c.splashSink).toBeGreaterThan(30);
    // The slam takes half the closing speed, the water most of the rest within a second; it never throws the car back out.
    expect(maxAfter).toBeLessThan(c.splashSpeed * 0.75);
    expect(atOne).toBeLessThan(c.splashSpeed * 0.15);
    expect(c.flood).toBeLessThan(0.5);
  });
  it('mud grips less, rolls harder and lets the tyres settle in: the same full-throttle start is slower in it', () => {
    const m = LINEUP.surfaces.mud[1];
    const start = (x) => {
      const run = createRun('lineup');
      run.car.pos.x = x; run.car.pos.z = m.z - m.rz * 0.6;
      const inp = newInput(); inp.assist = 1; inp.throttle = 1;
      const seen = { mud: 0, minY: Infinity };
      for (let i = 0; i < 240 * 2.5; i++) {
        stepRun(run, inp);
        seen.mud = Math.max(seen.mud, run.car.mud);
        if (i > 120 && run.car.mud === 4) seen.minY = Math.min(seen.minY, run.car.pos.y);
      }
      return { v: Math.hypot(run.car.vel.x, run.car.vel.z), ...seen, y: run.car.pos.y };
    };
    const mud = start(m.x), dry = start(-m.x);
    expect(mud.mud).toBe(4);
    expect(dry.mud).toBe(0);
    expect(mud.v).toBeLessThan(dry.v * 0.9);
    expect(mud.minY).toBeLessThan(0.4 - 0.02);   // settled into it
    expect(MATERIALS.mud.grip).toBeLessThan(MATERIALS.grass.grip);
  });
  it('a muddy roll-out is a fact the panel has, and says', () => {
    const r = SURFACE_RUNS.find((x) => x.name === 'mud-lineup-long');
    const run = simulate(r.log(), 'lineup');
    const card = scoreRun(run.t);
    expect(run.t.mudTime).toBeGreaterThan(0.5);
    expect(card.facts.mudS).toBeGreaterThan(0.5);
    expect(card.facts.splash).toBe(false);
    expect(card.facts.crashed).toBe(false);
    expect(localWords(card).designer).toContain(`${card.facts.mudS} s ploughing through the mud`);
  });
});

describe('surfaces: a run\'s identity', () => {
  it('a challenge packs the course\'s version, and a v32 one on a wet set (the Lineup) is still a challenge', async () => {
    const log = [[0, ...new Array(23).fill(0)]];
    const at = (o) => decodeChallenge(`r${toB64url(packBytes({ log, score: 50, ...o }))}`);
    expect((await at({ course: 'show' })).simVersion).toBe(MARK_VERSION);
    expect((await at({ course: 'lineup' })).simVersion).toBe(RUNUP_VERSION);
    expect((await at({ course: 'lineup', simVersion: SURFACE_VERSION })).stale).toBe(false);
    expect((await at({ course: 'wall' })).simVersion).toBe(MARK_VERSION);
    expect((await at({ course: 'lineup', simVersion: 32 })).stale).toBe(false);
    expect((await at({ course: 'show', simVersion: 33 })).stale).toBe(true);
    expect((await at({ course: 'lineup', simVersion: 31 })).stale).toBe(true);
    expect((await at({ course: 'wall', simVersion: 33 })).stale).toBe(true);
    expect(COURSES.show).toBe(SHOW);
  });
});

describe('surfaces: the board (the frozen Worker) takes a wet run as it is', () => {
  // The client posts its log and its telemetry (src/panel.js); the Worker checks it against the log and scores it with
  // the same scoreRun (src/worker/index.js boardCheck). Course ids are unchanged and the new keys are plain numbers and
  // booleans, so a splash and a muddy roll-out post like any run, judged as the client judged them.
  const post = (name, course) => {
    const r = SURFACE_RUNS.find((x) => x.name === name), run = simulate(r.log(), course);
    return { run, res: boardCheck({ log: run.inputLog, t: JSON.parse(JSON.stringify(run.t)), course }) };
  };
  it('a splash is accepted as the wreck it is', () => {
    const { run, res } = post('splash-show-wide', 'show');
    expect(res.error).toBeUndefined();
    expect(res.card.verdict).toBe('Splash');
    expect(res.card.total).toBe(scoreRun(run.t).total);
    expect(res.card.facts.splash).toBe(true);
  });
  it('a muddy landing is accepted with its time in the mud', () => {
    const { run, res } = post('mud-lineup-long', 'lineup');
    expect(res.error).toBeUndefined();
    expect(res.card.total).toBe(scoreRun(run.t).total);
    expect(res.card.facts.mudS).toBeGreaterThan(0.5);
  });
});
