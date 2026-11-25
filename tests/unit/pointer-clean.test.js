// 0261: on keys, a pad and two thumbs, Assist's (and Pro's) clean line names what the score still pays for: the category
// with the most points left on this run's card, with the scorer's own full-marks threshold, never one already at 10.
// When nothing steered has 0.1 point left it says what What happened says (src/sim/coach.js: on Assist, try Pro).
import { describe, it, expect, beforeAll } from 'vitest';
import { createRun, stepRun } from '../../src/sim/run.js';
import { createAutopilot } from '../../src/sim/autopilot.js';
import { scoreRun, LANDING, SHOW_MARK_RING, CLEARANCE, LINEUP_FULL, SHOW_GAS_FULL } from '../../src/sim/judge.js';
import { coach, KEY_WORDS } from '../../src/sim/coach.js';
import { pointerText, pickPointer, cleanTarget, pointsLeft, markRing, CLEAN_MIN_POINTS } from '../../src/pointer.js';
import { toUS } from '../../src/units.js';

const KEY = { device: 'key', scheme: 'classic', tier: 'assist', course: 'show' };
const TOUCH = { ...KEY, device: 'touch' };
const PAD = { ...KEY, device: 'pad' };
const PRO = { ...KEY, tier: 'pro' };
const THUMB = { ...KEY, device: 'touch', scheme: 'thumb' };

const refs = {};
function fly(course) {
  const run = createRun(course), ap = createAutopilot(course);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return { t: run.t, card: scoreRun(run.t), log: run.inputLog };
}
beforeAll(() => { for (const c of ['show', 'wall', 'lineup']) refs[c] = fly(c); }, 120000);

// Names of what a line asks for, per category, to check none is already at full marks.
const NAMES = { precision: /mark/, landing: /touchdown|touch down|wheels down/, clearance: /roofs/, efficiency: /gas/, height: /apex/, rotation: /turn/ };

describe('the clean line (0261)', () => {
  it('the Show reference on Assist keys names the row clearance at 2 m, never softer or the mark', () => {
    const { card } = refs.show;
    expect(card.total).toBe(97.3);
    expect(card.facts.sink).toBeLessThanOrEqual(LANDING.sink[1]);
    expect(card.categories.precision).toBe(10);
    for (const ctx of [KEY, TOUCH, PAD]) {
      const line = pointerText('clean', ctx, null, card);
      expect(line).not.toMatch(/softer|closer to the mark|\bmark\b/);
      expect(line).toBe(`Clean. Next: cross the roofs within 2 m (this one ${card.facts.clearance.toFixed(1)} m)`);
      expect(toUS(line)).toMatch(/within 6\.6 ft/);
    }
    // The threshold is the scorer's: the clearance curve's last full mark.
    expect(CLEARANCE.filter(([, v]) => v === 1).map(([x]) => x).pop()).toBe(2);
  });

  it('on every reference, the named category has headroom on the card', () => {
    for (const course of ['show', 'wall', 'lineup']) {
      const { card } = refs[course];
      const ctx = { ...KEY, course };
      const k = cleanTarget(card, course, 'assist');
      const line = pointerText('clean', ctx, null, card);
      if (k) {
        expect(card.categories[k]).toBeLessThan(10);
        expect(pointsLeft(card)[k]).toBeGreaterThanOrEqual(CLEAN_MIN_POINTS);
        expect(line).toMatch(NAMES[k]);
      }
      for (const [cat, rx] of Object.entries(NAMES)) if (cat !== k && card.categories[cat] === 10) expect(line).not.toMatch(rx);
    }
  });

  it('pickPointer hands the card through on a clean run, as main.js calls it', () => {
    const { t, card, log } = refs.show;
    const { items, flight } = coach(log, 'show', card);
    expect(items[0].id).toBe('clean');
    const p = pickPointer(items, KEY, { card, flight });
    expect(p.id).toBe('clean');
    expect(p.text).toBe(pointerText('clean', KEY, flight, card));
    expect(p.text).toMatch(/roofs/);
  });

  // A table of synthetic clean cards on the Show: one category short at a time.
  const base = () => JSON.parse(JSON.stringify(refs.show.card));
  const withCats = (cats, facts = {}) => { const c = base(); Object.assign(c.categories, cats); Object.assign(c.facts, facts); return c; };
  it('never names the mark at precision 10, nor a softer touchdown at a sink ≤ 0.9 m/s', () => {
    const cards = [
      withCats({ clearance: 10, landing: 9, precision: 10, efficiency: 10 }, { sink: 0.81, headingDeg: 9, tiltDeg: 0.5, wheelSpreadMs: 10, padMiss: 1.5 }),
      withCats({ clearance: 10, landing: 9.5, precision: 10, efficiency: 7 }, { sink: 0.5, airPct: 30 }),
      withCats({ clearance: 9, landing: 10, precision: 10, efficiency: 10 }, { sink: 0.9, clearance: 0.3 }),
      withCats({ clearance: 10, landing: 10, precision: 8, efficiency: 10 }, { sink: 0.7, padMiss: 4.8 }),
      withCats({ clearance: 10, landing: 8, precision: 10, efficiency: 10 }, { sink: 2.1, headingDeg: 0, tiltDeg: 0, wheelSpreadMs: 0 }),
    ];
    const lines = cards.map((c) => pointerText('clean', KEY, null, c));
    // The heading is the pilot's (the yaw keys) on Assist too.
    expect(lines[0]).toBe('Clean. Next: touch down straight, within 2° of the line (this one 9.0°)');
    // (On Pro ×1.08 caps a judge at 10, so a card this strong has nothing left: a weaker landing does.)
    expect(pointerText('clean', PRO, null, { ...cards[0], tier: 'pro' })).toMatch(/try Advanced/);
    const proCard = { ...withCats({ landing: 7 }, { sink: 0.81, headingDeg: 20, tiltDeg: 0.5, wheelSpreadMs: 10 }), tier: 'pro' };
    expect(pointerText('clean', PRO, null, proCard)).toBe('Clean. Next: touch down straight, within 2° of the line (this one 20.0°)');
    // Assist's LAND levels the car: a tilt or a wheel spread isn't the pilot's there, so it isn't named; on Pro it is.
    const tilted = withCats({ clearance: 10, landing: 8 }, { sink: 0.5, headingDeg: 0, tiltDeg: 8, wheelSpreadMs: 10 });
    expect(pointerText('clean', KEY, null, tilted)).toBe('Clean. Next: try Pro and fly the landing yourself (×1.08)');
    expect(pointerText('clean', PRO, null, { ...tilted, tier: 'pro', categories: { ...tilted.categories, landing: 6 } })).toBe('Clean. Next: touch down level, within 1.5° (this one 8.0°)');
    // The card's tier, not the picker's: a Pro card read with an Assist context still says what Pro's card says.
    expect(pointerText('clean', KEY, null, proCard)).toBe(pointerText('clean', PRO, null, proCard));
    expect(lines[1]).toBe(`Clean. Next: keep ${SHOW_GAS_FULL} % of the gas (this one 30 %)`);
    expect(lines[2]).toBe('Clean. Next: clear the roofs by at least 0.8 m (this one 0.3 m)');
    expect(lines[3]).toBe(`Clean. Next: land within ${SHOW_MARK_RING} m of the mark (this one 4.8 m)`);
    expect(lines[4]).toBe(`Clean. Next: a touchdown under ${LANDING.sink[1]} m/s (this one 2.1 m/s)`);
    cards.forEach((c, i) => {
      if (c.categories.precision === 10) expect(lines[i]).not.toMatch(/mark/);
      if (c.facts.sink <= LANDING.sink[1]) expect(lines[i]).not.toMatch(/softer|under 0\.9 m\/s/);
    });
  });

  it('with nothing steered left, it says what What happened says', () => {
    const full = withCats({ clearance: 10, landing: 10, precision: 10, efficiency: 10 });
    const { items } = coach(refs.show.log, 'show', refs.show.card);
    expect(items[0].fix).toMatch(/Try Pro/);
    expect(pointerText('clean', KEY, null, full)).toBe('Clean. Next: try Pro and fly the landing yourself (×1.08)');
    expect(pointerText('clean', PRO, null, { ...full, tier: 'pro' })).toMatch(/try Advanced/);
  });

  it('Pro quotes the scorer’s thresholds: 0.9 m/s and the course’s full-marks ring', () => {
    expect(pointerText('clean', PRO)).toBe(`Clean. Next: under ${LANDING.sink[1]} m/s and inside the ${SHOW_MARK_RING} m ring`);
    expect(pointerText('clean', PRO)).toBe('Clean. Next: under 0.9 m/s and inside the 2 m ring');   // 0360: the bullseye
    expect(pointerText('clean', { ...PRO, course: 'lineup' })).toBe(`Clean. Next: under 0.9 m/s and inside the ${LINEUP_FULL.padMiss} m ring`);
    expect(markRing('wall')).toBe(SHOW_MARK_RING);
    // With a card, Pro names what's left like Assist.
    expect(pointerText('clean', PRO, null, { ...refs.show.card, tier: 'pro' })).toMatch(/^Clean\. Next: /);
  });

  it('one thumb is unchanged (0156)', () => {
    const at = (m) => ({ touch: { padMiss: m } });
    expect(pointerText('clean', THUMB, at(2.43), refs.show.card)).toBe('Clean, 2.4 m from the mark. Next: try Pro and fly the landing yourself');
  });

  it('no number or a turn-scaled gas score is never quoted; a Lineup with no full turn has no headroom', () => {
    expect(pointerText('clean', KEY, null, withCats({ clearance: 8, landing: 10, efficiency: 10 }, { clearance: null }))).not.toMatch(/roofs/);
    expect(pointerText('clean', KEY, null, withCats({ clearance: 10, landing: 10, efficiency: 6 }, { airPct: 50, rollDeg: 90, pitchDeg: 0 }))).not.toMatch(/gas/);
    const l = JSON.parse(JSON.stringify(refs.lineup.card)); l.facts.rotations = 0;
    expect(pointsLeft(l)).toEqual({});
    expect(pointerText('clean', { ...KEY, course: 'lineup', tier: 'advanced' }, null, { ...l, tier: 'advanced' })).toBe('Clean. Nothing left on this card the score pays for');
  });

  it('a crashed card has no headroom to name', () => {
    const c = base(); c.facts.crashed = true;
    expect(pointsLeft(c)).toEqual({});
  });
});
