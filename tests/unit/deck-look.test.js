// 0187: the Wall's climb and hang read as a white car on a grey deck. The deck look's factor (src/render/deck-look.js)
// and the look audit's two measures (scripts/look-measure.mjs), on the reference flight and on synthetic images.
import { describe, it, expect } from 'vitest';
import { deckLook } from '../../src/render/deck-look.js';
import { redShare, lumPercentile, isSaturatedRed } from '../../scripts/look-measure.mjs';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { SHOW, WALL, wallProfile } from '../../src/sim/courses.js';

describe('deckLook: on the deck from where the car is (0187)', () => {
  it('is 0 parked at the start and on the approach, on both Wall courses', () => {
    for (const c of [SHOW, WALL]) expect(deckLook(0, 0.4, c.start.z)).toBe(0);
    expect(deckLook(0, 0.4, -2)).toBe(0);
    expect(deckLook(0, 0.4, 0.3)).toBe(0);
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
