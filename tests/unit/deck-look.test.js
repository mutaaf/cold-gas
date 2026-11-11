// 0187: the Wall's climb and hang read as a white car on a grey deck. The deck look's factor (src/render/deck-look.js)
// and the look audit's two measures (scripts/look-measure.mjs), on the reference flight and on synthetic images.
import { describe, it, expect } from 'vitest';
import { deckLook, flownFor, FLOWN_TICKS } from '../../src/render/deck-look.js';
import { FRAME_EVERY } from '../../src/sim/run.js';
import { redShare, lumPercentile, isSaturatedRed } from '../../scripts/look-measure.mjs';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { SHOW, WALL, wallProfile } from '../../src/sim/courses.js';

describe('deckLook: on the deck from where the car is (0187)', () => {
  it('is 1 parked at the start and on the run-up, on both Wall courses (0193: the run-up is not a red room)', () => {
    for (const c of [SHOW, WALL]) expect(deckLook(0, 0.4, c.start.z)).toBe(1);
    expect(deckLook(0, 0.4, -2)).toBe(1);
    expect(deckLook(0, 0.4, 0.3)).toBe(1);
    expect(deckLook(3, 0.4, -7)).toBe(1);                  // beside the line on the run-up too
  });

  it('once flown it is 0187\'s look: 0 on both pads (the Wall\'s is on the run-up) and over the run-up (0193)', () => {
    for (const c of [SHOW, WALL]) for (const dz of [-7, -4, -2, 0, 2, 4, 7]) expect(deckLook(0, 0.4, c.pad.z + dz, true)).toBe(0);
    expect(deckLook(0, 0.4, -3, true)).toBe(0);
    expect(deckLook(0, 4, -3)).toBe(0);                    // 4 m up over the run-up, even before a launch
    expect(deckLook(0, 0.4, -14)).toBe(0);                 // behind the start
  });

  for (const c of [SHOW, WALL]) {
    it(`on the reference ${c.id}: 1 from the first tick through the run-up and the climb, 0 at touchdown, never a cut (0193)`, () => {
      const run = createRun(c.id), ap = createAutopilot(c.id);
      const look = () => deckLook(run.car.pos.x, run.car.pos.y, run.car.pos.z, flownFor(run.tick, run.t.launchTick));
      let maxStep = 0, prev = look(), minRunUp = 1, landK = null;
      expect(prev).toBe(1);
      while (run.phase !== 'done' && run.tick < 240 * 30) {
        stepRun(run, ap(run));
        const k = look();
        maxStep = Math.max(maxStep, Math.abs(k - prev)); prev = k;
        if (run.phase === 'drive' || (run.phase === 'ramp' && run.t.invertedTime === 0 && run.car.pos.y < 6.4)) minRunUp = Math.min(minRunUp, k);
        if (run.phase === 'landed' && landK === null) landK = k;
      }
      expect(minRunUp).toBe(1);
      expect(landK).toBe(0);
      expect(maxStep).toBeLessThan(0.02);
      // The replay reads the same look from its own clock: frame i is tick i·FRAME_EVERY, and the run's launch tick.
      const fr = run.frames, lt = run.t.launchTick;
      let rMax = 0, rPrev = null;
      for (let i = 0; i < fr.length; i++) {
        const k = deckLook(fr[i][0], fr[i][1], fr[i][2], flownFor(i * FRAME_EVERY, lt));
        if (i === 0) expect(k).toBe(1);
        if (rPrev !== null) rMax = Math.max(rMax, Math.abs(k - rPrev));
        rPrev = k;
      }
      expect(rPrev).toBe(0);                                 // the replay ends on the pad in the course's own look
      expect(rMax).toBeLessThan(0.05);
    });
  }

  it('flownFor: 0 before the launch (or with none), 1 a second after it, a ramp between', () => {
    expect(flownFor(500, -1)).toBe(0);
    expect(flownFor(99, 100)).toBe(0);
    expect(flownFor(100, 100)).toBe(0);
    expect(flownFor(100 + FLOWN_TICKS / 2, 100)).toBeCloseTo(0.5, 9);
    expect(flownFor(100 + FLOWN_TICKS, 100)).toBe(1);
    expect(flownFor(1e6, 100)).toBe(1);
  });

  it('a car that leaves the curl low fades out of the run-up look over a second, never in one frame', () => {
    // Launched at the curl's foot (0187's own term is 0 there): the run-up term fades with flown.
    const at = (f) => deckLook(0, 1.0, 0.5, f);
    expect(at(0)).toBe(1);
    let prev = at(0), maxStep = 0;
    for (let t = 1; t <= FLOWN_TICKS; t++) { const k = at(flownFor(t, 0)); maxStep = Math.max(maxStep, Math.abs(k - prev)); prev = k; }
    expect(prev).toBe(0);
    expect(maxStep).toBeLessThan(0.01);
  });

  it('on the reference Show: full up the climb and the hang, off again after the release, and never jumps', () => {
    const run = createRun('show'), ap = createAutopilot('show');
    let maxStep = 0, prev = deckLook(run.car.pos.x, run.car.pos.y, run.car.pos.z), climbK = null, hang = [], afterRelease = null, releaseTick = null;
    while (run.phase !== 'done' && run.tick < 240 * 30) {
      stepRun(run, ap(run));
      const k = deckLook(run.car.pos.x, run.car.pos.y, run.car.pos.z);
      expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(k - prev)); prev = k;
      if (climbK === null && run.phase === 'ramp' && run.car.pos.y > 6.4) climbK = k;
      if (run.phase === 'ramp' && run.t.invertedTime > 0) hang.push(k);
      if (run.phase === 'air' && releaseTick === null) releaseTick = run.tick;
      if (releaseTick !== null && run.tick === releaseTick + 240 && afterRelease === null) afterRelease = k;
    }
    expect(climbK).toBe(1);                                // the climb's moment (car 6–8 m up)
    expect(hang.length).toBeGreaterThan(240);
    expect(Math.min(...hang)).toBe(1);                     // the whole hang
    expect(afterRelease).toBe(0);                          // 1 s after letting go, the course's own look
    expect(maxStep).toBeLessThan(0.02);                    // a fade over many frames, never a cut
  });
});

describe('deckLook: off the deck is off, whichever way the car leaves it', () => {
  const at = (s, off) => { const p = wallProfile(s); return [p.z + p.nz * off, p.y + p.ny * off]; };
  it('on the deck mid-curl: 1; beside it on the floor or flown up past the lip: 0', () => {
    const [z, y] = at(25, 0.45);
    expect(deckLook(0, y, z)).toBe(1);
    expect(deckLook(8, y, z)).toBe(0);                                   // 6 m out past the deck's edge
    const lip = wallProfile(WALL.length);
    // 20 m past the lip, 1 m under the ledge's line carried on (a car thrusting up after letting go)
    const tz = lip.tz, ty = lip.ty;
    expect(deckLook(0, lip.y + ty * 20 + lip.ny * 1, lip.z + tz * 20 + lip.nz * 1)).toBe(0);
    const past = (u) => deckLook(0, lip.y + ty * u + lip.ny * 0.45, lip.z + tz * u + lip.nz * 0.45);
    expect(past(1)).toBeGreaterThan(past(3)); expect(past(3)).toBeGreaterThan(0); expect(past(6.5)).toBe(0);   // fades out along the ledge too
  });
});

describe('look measures (scripts/look-measure.mjs)', () => {
  const img = (w, h, fill) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set([...fill(i % w, Math.floor(i / w)), 255], i * 4); return d; };

  it('counts saturated red only: red-dominant, saturation > 0.5, value > 40', () => {
    expect(isSaturatedRed(200, 20, 30)).toBe(true);
    expect(isSaturatedRed(200, 120, 120)).toBe(false);   // pink: saturation 0.4
    expect(isSaturatedRed(40, 0, 0)).toBe(false);        // too dark
    expect(isSaturatedRed(20, 200, 20)).toBe(false);     // green
    expect(isSaturatedRed(128, 128, 128)).toBe(false);   // grey
    expect(isSaturatedRed(255, 255, 0)).toBe(false);     // yellow: a red/green tie
    expect(isSaturatedRed(255, 0, 255)).toBe(false);     // magenta
  });

  it('redShare: a quarter of the frame red reads 25 %, and inside a rect', () => {
    const d = img(20, 20, (x, y) => (x < 10 && y < 10 ? [220, 10, 20] : [90, 90, 95]));
    expect(redShare(d, 20, 20)).toBeCloseTo(0.25, 6);
    expect(redShare(d, 20, 20, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(redShare(d, 20, 20, { x: 10, y: 10, w: 30, h: 30 })).toBe(0);   // clipped to the image
  });

  it('lumPercentile: P10 of a box that is 10 % black is 0, 9 % black is not', () => {
    const ten = img(10, 10, (x, y) => (y === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(lumPercentile(ten, 10, 10, null, 10)).toBe(0);
    expect(lumPercentile(ten, 10, 10, null, 50)).toBe(255);
    const nine = img(10, 10, (x, y) => (y === 0 && x < 9 ? [0, 0, 0] : [255, 255, 255]));
    expect(lumPercentile(nine, 10, 10, null, 10)).toBe(255);
    expect(lumPercentile(ten, 10, 10, { x: 0, y: 5, w: 10, h: 5 }, 10)).toBe(255);   // the rect only
    expect(lumPercentile(ten, 10, 10, { x: 40, y: 40, w: 5, h: 5 }, 10)).toBeNull();  // nothing inside
  });
});
