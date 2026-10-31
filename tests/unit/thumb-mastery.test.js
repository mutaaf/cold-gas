// 0117 thumb mastery: the one-thumb touchdown slide (src/onethumb.js) is plain sim input (it replays and
// scores bit-exactly), a thumb that never slides flies exactly as before, a careful slide lands nearer
// the mark and scores more, and no slide, however wild, puts the car on the row. Plus the medals
// (src/medals.js): bars, the next-target line, and storage that may not be there.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRun, stepRun, simulate } from '../../src/sim/run.js';
import { newInput } from '../../src/sim/vehicle.js';
import { scoreRun } from '../../src/sim/judge.js';
import { predict, newPrediction } from '../../src/sim/predict.js';
import { SPEC } from '../../src/sim/spec.js';
import { createOneThumb, thumbStage, markOffset, THUMB } from '../../src/onethumb.js';
import { MEDALS, MEDAL_KEY, thresholds, medalFor, nextMedal, nextTargetText, getMedals, recordRun, _resetMedalCache } from '../../src/medals.js';

// The Show the way main.js flies it: hold up the curl, stop on the ledge, a short tap to let go
// (the drive-off and the push-off), then press and hold in the air; `slide(run, th)` moves the thumb.
function flyThumb({ slide = null, holdAt = 'tap' } = {}) {
  const run = createRun('show'), th = createOneThumb();
  let released = false, ledgeT = -1, tapT = -1;
  th.down();
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput();
    if (tapT < 0 && thumbStage(run, released) === 'ledge' && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3) {
      if (ledgeT < 0) { ledgeT = run.tick; th.up(); }
      if (run.tick === ledgeT + 120) { th.down(); tapT = run.tick; }
    }
    if (tapT > 0 && run.tick === tapT + 24 && holdAt !== 'tap') th.up();
    if (released && holdAt !== 'tap' && !th.held && c.vel.y < 0 && c.pos.y < holdAt) th.down();
    if (slide && released && run.phase === 'air' && th.held) slide(run, th);
    th.sample(run, released, inp);
    if ((run.phase === 'ramp' && inp.lift > 0) || run.phase === 'air') released = true;
    inp.fan = !released && (run.phase === 'ramp' || (run.phase === 'drive' && c.pos.z > -16)) ? 1 : 0;
    stepRun(run, inp);
  }
  return run;
}
// A careful thumb: on the sight's dot, re-read every 0.3 s (the pad's own markOffset).
function careful() {
  const pr = newPrediction(), off = { x: 0, y: 0, m: 0 };
  let next = 0, want = null;
  return (run, th) => {
    if (run.tick >= next) {
      predict(run.car, Math.max(0, run.car.pos.y - SPEC.comHeight), pr);
      markOffset(run.car, pr, 'show', off);
      want = { x: off.x, y: -off.y };
      next = run.tick + 72;
    }
    th.move(want.x, want.y);
  };
}
const pitchRoll = (run) => run.inputLog.some((e) => e[4] !== 0 || e[5] !== 0);   // [tick, throttle, brake, steer, pitch, roll, …]

describe('one-thumb touchdown slide (0117)', () => {
  it('a thumb that never slides writes no pitch or roll (it flies as before)', () => {
    const run = flyThumb({ holdAt: 12 });
    expect(pitchRoll(run)).toBe(false);
    const s = scoreRun(run.t);
    expect(s.facts.crashed).toBe(false);
    expect(s.facts.padMiss).toBeGreaterThan(4);   // the computer's touchdown, off the mark
  });

  it('a careful slide onto the dot lands nearer the mark and scores no less, and replays bit-exactly', () => {
    const base = scoreRun(flyThumb({ holdAt: 12 }).t);
    const run = flyThumb({ holdAt: 12, slide: careful() });
    const s = scoreRun(run.t);
    expect(pitchRoll(run)).toBe(true);
    expect(s.facts.crashed).toBe(false);
    expect(s.facts.padMiss).toBeLessThan(base.facts.padMiss - 0.5);
    expect(s.total).toBeGreaterThanOrEqual(base.total);
    const again = simulate(run.inputLog, 'show');   // the Worker's path
    expect(again.car.pos).toEqual(run.car.pos);
    expect(scoreRun(again.t).total).toBe(s.total);
  });

  it('no held slide, however wild, lands on the row or rolls it', () => {
    for (const [x, y] of [[60, 0], [-60, 0], [0, 60], [0, -60], [60, 60], [-60, -60], [60, -60], [-60, 60]]) {
      for (const holdAt of ['tap', 12]) {
        const s = scoreRun(flyThumb({ holdAt, slide: (run, th) => th.move(x, y) }).t);
        expect(s.facts.contact, `${x},${y} ${holdAt}`).toBe(false);
        expect(s.facts.crashed, `${x},${y} ${holdAt}`).toBe(false);
      }
    }
  });

  it('the slide never flies the car upside down or into the set-down', () => {
    const run = createRun('show'), th = createOneThumb(), inp = newInput();
    th.down(); th.move(48, 48);
    run.phase = 'air'; run.t.crossedRow = true;
    run.car.pos.z = -32; run.car.pos.y = 6;
    run.car.quat.w = 0; run.car.quat.z = 1;   // inverted
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
    run.car.quat.w = 1; run.car.quat.z = 0;   // upright: full command
    Object.assign(inp, newInput());
    th.sample(run, true, inp);
    expect(inp.pitch).toBeCloseTo(THUMB.aimPitch, 6); expect(inp.roll).toBeCloseTo(THUMB.aimRoll, 6);
    run.car.pos.y = SPEC.comHeight + THUMB.aimFloor - 0.1;   // the last metre: level
    Object.assign(inp, newInput());
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
  });

  it('a slide inside the dead zone moves nothing (a resting thumb keeps LAND\'s line hold)', () => {
    const run = createRun('show'), th = createOneThumb(), inp = newInput();
    th.down(); th.move(THUMB.aimPx * THUMB.aimDead * 0.9, -THUMB.aimPx * THUMB.aimDead * 0.9);
    run.phase = 'air'; run.t.crossedRow = true; run.car.pos.z = -32; run.car.pos.y = 6;
    th.sample(run, true, inp);
    expect(inp.pitch).toBe(0); expect(inp.roll).toBe(0);
    expect(th.aim.x).toBe(0);
  });
});

// A localStorage stand-in for Node.
function fakeStorage({ throws = false } = {}) {
  const m = new Map();
  return { getItem: (k) => { if (throws) throw new Error('denied'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (throws) throw new Error('denied'); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), _m: m };
}

describe('medals (0117)', () => {
  beforeEach(() => { globalThis.localStorage = fakeStorage(); _resetMedalCache(); });

  it('bars rise bronze → silver → gold for every event and tier, and gold is under 100', () => {
    for (const c of Object.keys(MEDALS)) for (const t of ['assist', 'pro', 'advanced']) {
      const th = thresholds(c, t);
      expect(th.bronze).toBeLessThan(th.silver);
      expect(th.silver).toBeLessThan(th.gold);
      expect(th.gold).toBeLessThan(100);
    }
    // Pro and Advanced ask more than Assist.
    expect(thresholds('show', 'pro').gold).toBeGreaterThan(thresholds('show', 'assist').gold);
  });

  it('a never-slide one-thumb run is bronze on the Show, and the reference flight is gold', () => {
    expect(medalFor('show', 'assist', 90.3)).toBe('bronze');
    expect(medalFor('show', 'assist', 94)).toBe('gold');
    expect(medalFor('show', 'assist', 50)).toBe(null);
  });

  it('the next-target line reads "Silver at 91 · 3.2 to go"', () => {
    const { silver } = thresholds('show', 'assist');
    expect(nextTargetText('show', 'assist', 87.8, 87.8)).toBe(`Silver at ${silver} · ${(silver - 87.8).toFixed(1)} to go`);
    expect(nextMedal('show', 'assist', 99)).toBe(null);
    expect(nextTargetText('show', 'assist', 99)).toMatch(/Gold held/);
  });

  it('keeps the best per event and tier on this device, and says when a medal is new', () => {
    expect(getMedals('show', 'assist').best).toBe(null);
    let r = recordRun('show', 'assist', 88);
    expect(r.isNew).toBe(true); expect(r.after.medal).toBe('bronze');
    r = recordRun('show', 'assist', 80);
    expect(r.isNew).toBe(false); expect(r.after.best).toBe(88);
    r = recordRun('show', 'assist', 93.4);
    expect(r.after.medal).toBe('gold'); expect(r.isNew).toBe(true);
    expect(getMedals('show', 'pro').best).toBe(null);   // tiers apart
    expect(JSON.parse(globalThis.localStorage.getItem(MEDAL_KEY))['show:assist']).toBe(93.4);
    _resetMedalCache();
    expect(getMedals('show', 'assist').medal).toBe('gold');   // back from storage
  });

  it('runs on without storage (private mode) and ignores junk', () => {
    globalThis.localStorage = fakeStorage({ throws: true }); _resetMedalCache();
    expect(() => recordRun('wall', 'assist', 91)).not.toThrow();
    expect(getMedals('wall', 'assist').medal).toBe('silver');   // this session still counts
    globalThis.localStorage = fakeStorage(); globalThis.localStorage.setItem(MEDAL_KEY, '{"show:assist":"x","bad key":5,"wall:pro":101}'); _resetMedalCache();
    expect(getMedals('show', 'assist').best).toBe(null);
    expect(getMedals('wall', 'pro').best).toBe(null);
  });
});
