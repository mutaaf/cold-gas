// 0372: the judges never praise a touchdown that never happened. On a Lineup card that ended on the row with no wheel
// touchdown (0369: !jumped && contact), the brief still gives the model "Touchdown sink 0 m/s, tilt 0 degrees, heading
// 0 degrees" (src/worker/ai/prompt.js, frozen; 0195 carries that half), and the Engineer calls the landing perfect over
// LANDING 0.0. The client half: such a remark is unfaithful, and the sheet shows the same judge's own line (as 0282).
import { describe, it, expect } from 'vitest';
import { checkWords, faithfulWords, liveFaithful, replacedLine, noTouchdown, praisesTouchdown } from '../../src/check-words.js';
import { localWords } from '../../src/panel.js';

// The two remarks the edge model (gemma-4-26b-a4b-it) wrote on production 7efa88f, verbatim
// (docs/critique/2026-11-26-1538/lineup-keys-floor.out.txt and lineup-keys-late.out.txt).
const FLOOR = 'Touchdown parameters were perfect, but the collision preceded a stable sink rate and level attitude.';
const LATE = 'Despite the perfect sink rate and attitude, the impact with the vehicle caused catastrophic structural failure.';

const facts = (o) => ({ course: 'lineup', height: 0.8, apex: 0.8, rollDeg: 0, pitchDeg: 0, sink: 0, tiltDeg: 0, headingDeg: 0, launchKmh: 79, damagePct: 96, integrity: 4, crashed: true, contact: true, jumped: false, endReason: 'contact', ...o });
const ROW_HIT = { course: 'lineup', total: 4, verdict: 'Wrecked', tier: 'assist', multiplier: 1, judges: [{ id: 'engineer', score: 0.4 }, { id: 'coordinator', score: 0.4 }, { id: 'designer', score: 0.4 }], categories: { height: 0, rotation: 0, landing: 0, damage: 0.4 }, facts: facts({}) };
const LANDED = { ...ROW_HIT, total: 71.2, verdict: 'Rough', categories: { height: 7, rotation: 8, landing: 7.5, damage: 9 }, facts: facts({ jumped: true, contact: false, crashed: false, sink: 0.8, tiltDeg: 2.1, headingDeg: 4, apex: 11, endReason: 'settled', damagePct: 4, integrity: 96 }) };
const words = (engineer) => ({ headline: 'Into the row', engineer, coordinator: 'A brave line at the row.', designer: 'Bold.', source: 'ai' });

describe('0372: which cards had no touchdown', () => {
  it('a Lineup row hit with no wheel touchdown; never a landed card, never another course', () => {
    expect(noTouchdown(ROW_HIT)).toBe(true);
    expect(noTouchdown(LANDED)).toBe(false);
    expect(noTouchdown({ ...ROW_HIT, course: 'show', facts: { ...ROW_HIT.facts, course: 'show' } })).toBe(false);
    expect(noTouchdown(null)).toBe(false);
    // scoreLineup's own card names no course; the Show's and the Wall's carry it in facts.course.
    const { course, ...bare } = ROW_HIT, { course: fc, ...bareFacts } = ROW_HIT.facts;
    expect(course).toBe('lineup'); expect(fc).toBe('lineup');
    expect(noTouchdown({ ...bare, facts: bareFacts })).toBe(true);
    expect(noTouchdown({ ...bare, facts: { ...bareFacts, course: 'wall' } })).toBe(false);
  });
});

describe('0372: a remark that gives a touchdown a quality', () => {
  it('both production remarks praise one', () => {
    expect(praisesTouchdown(FLOOR)).toBe(true);
    expect(praisesTouchdown(LATE)).toBe(true);
  });
  it('other ways of saying it', () => {
    for (const s of ['A textbook landing.', 'Landed it cleanly.', 'The sink rate was ideal.', 'Soft touchdown, level tilt.', 'It touched down smoothly.', 'Flawless set-down.']) {
      expect(praisesTouchdown(s), s).toBe(true);
    }
  });
  it('what is true of a row hit is not caught', () => {
    for (const s of ['It never got a clean landing.', 'No touchdown to speak of: it went into the row.', 'A perfect run-up wasted on the roofs.',
      'The impact with the vehicle caused catastrophic structural failure.', 'Clean lift, then straight into the Semi.', 'There was no landing to judge.',
      'Into the row without a soft landing.']) {
      expect(praisesTouchdown(s), s).toBe(false);
    }
  });
});

describe('0372: checkWords and faithfulWords', () => {
  it('both remarks are rejected on a row hit, and the sheet shows the Engineer’s local line', () => {
    for (const r of [FLOOR, LATE]) {
      const w = words(r);
      expect(checkWords(w, ROW_HIT)).toEqual(['engineer']);
      const { words: out, replaced } = faithfulWords(w, ROW_HIT, localWords);
      expect(replaced).toEqual(['engineer']);
      expect(out.engineer).toBe(localWords(ROW_HIT).engineer);
      expect(out.coordinator).toBe(w.coordinator);
      expect(praisesTouchdown(out.engineer)).toBe(false);
    }
  });
  it('the same remarks on a landed Lineup card (sink 0.8 m/s) are not rejected for this', () => {
    for (const r of [FLOOR, LATE]) expect(checkWords(words(r), LANDED)).toEqual([]);
  });
  it('the receipt names the reason: a landing the run never made, not a number', () => {
    const { reasons } = faithfulWords(words(LATE), ROW_HIT, localWords);
    expect(reasons).toEqual(['touchdown']);
    expect(replacedLine(1, reasons)).toBe('1 remark replaced with the game’s own line: it praised a landing the run never made');
    expect(replacedLine(2, ['touchdown', 'touchdown'])).toBe('2 remarks replaced with the game’s own lines: they praised a landing the run never made');
    expect(replacedLine(2, ['number', 'touchdown'])).toBe('2 remarks replaced with the game’s own lines: they said what the run didn’t do');
    // 0282's line is unchanged with no reasons or numbers only.
    expect(replacedLine(1)).toBe('1 remark replaced with the game’s own line: it stated a number the run didn’t make');
    expect(replacedLine(1, ['number'])).toBe(replacedLine(1));
  });
  it('while it streams, the praise is never typed onto the sheet', () => {
    const live = liveFaithful(words(LATE), ROW_HIT, '', true);
    expect(live.engineer).toBe('Despite the');
    const floor = liveFaithful(words(FLOOR), ROW_HIT, '', false);
    expect(praisesTouchdown(floor.engineer)).toBe(false);
    expect(liveFaithful(words(LATE), LANDED, '', true).engineer).toBe(LATE);
  });
});

describe('0372 self-review: the shapes a model echoing the brief writes', () => {
  it('praise beside the brief’s own numbers, comparatives, the heading, idioms', () => {
    for (const s of ['A perfect 0 m/s sink rate.', 'A perfect 0.0 m/s sink.', 'Sink of 0 m/s: perfect.', 'A sink rate of 0 m/s is ideal.',
      'The cleanest landing of the night.', 'A softer touchdown than most.', 'The heading was perfect.', 'Despite the collision, sink was spot on.', 'Nailed the landing.',
      'A feather-light touchdown.', 'perfect—sink rate', 'Not level but the touchdown was perfect.']) {
      expect(praisesTouchdown(s), s).toBe(true);
    }
  });
  it('a denial inside the words or the clause is not praise', () => {
    for (const s of ['The landing was not perfect.', 'Touchdown parameters weren’t perfect.', 'Never a soft landing or a clean touchdown.',
      'The roof landing was anything but soft.']) {
      expect(praisesTouchdown(s), s).toBe(false);
    }
  });
});
