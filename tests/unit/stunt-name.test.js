// 0260: the stunt's name, from scoreRun's card only (src/stunt-name.js): for every run the native vectors fly (the
// references, the naive and fuzzed populations, the crashes), a name that starts with the event and says what was
// flown or what went wrong, in our own words. Pure: no DOM, no storage.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { runList } from '../../scripts/vectors-lib.mjs';
import { simulate } from '../../src/sim/run.js';
import { scoreRun } from '../../src/sim/judge.js';
import { stuntName, dareText, landedCard, EVENT_NAME } from '../../src/stunt-name.js';

let cards;
beforeAll(() => {
  cards = runList().map((r) => ({ name: r.name, course: r.course, card: scoreRun(simulate(r.log(), r.course).t) }));
}, 240_000);

// Words that would be someone else's: real makes and models, other games' trick names, IP we don't own (§3.7).
const BANNED = /\b(tesla|cyber|roadster|ford|chevy|toyota|honda|bmw|audi|porsche|ferrari|lambo|rivian|lucid|kickflip|tony|hawk|mario|forza|gran turismo|need for speed|barrel roll)\b/i;

describe('the stunt name (0260)', () => {
  it('names every vector run: the event first, then the trick or the cause, a few words, our own', () => {
    expect(cards.length).toBeGreaterThan(40);
    for (const { name, course, card } of cards) {
      const s = stuntName(card);
      expect(s.startsWith(`${EVENT_NAME[course]} · `), `${name}: ${s}`).toBe(true);
      expect(s.split(' · ').length, `${name}: ${s}`).toBeLessThanOrEqual(4);
      expect(s.length, `${name}: ${s}`).toBeLessThanOrEqual(44);
      expect(s, name).not.toMatch(BANNED);
      expect(stuntName(card, { short: true }).length).toBeLessThanOrEqual(s.length);
    }
  });
  it('the references read as what they fly', () => {
    const by = (n) => cards.find((c) => c.name === n).card;
    expect(landedCard(by('ref-show'))).toBe(true);
    expect(stuntName(by('ref-wall'))).toMatch(/^The Wall · hang \d+\.\d s/);
    expect(stuntName(by('ref-lineup'))).toMatch(/^The Lineup · 360 · over five/);
    expect(dareText(by('ref-show'))).toBe(`Beat my ${by('ref-show').total.toFixed(1)} on ${stuntName(by('ref-show'), { short: true })}`);
  });
  it('a wreck names its cause, and its words ask for a landing', () => {
    const crashes = cards.filter((c) => !landedCard(c.card));
    expect(crashes.length).toBeGreaterThan(0);
    for (const { card, course } of crashes) {
      const s = stuntName(card);
      expect(s).toMatch(new RegExp(`^${EVENT_NAME[course]} · (off the wall|wrecked on (the wall|landing|the run-up)|into the row|stalled on the wall|no climb|down on the deck|rolled over|crashed|short of the row|no jump)$`));
      expect(dareText(card)).toMatch(/Can you land it\?$/);
    }
  });
  it('a card it has never seen still gets a name, and nothing at all gets none', () => {
    expect(stuntName({ course: 'show', verdict: 'Clean', total: 80, facts: { jumped: true, crashed: false, rollDeg: 712, padMiss: 1.2 } })).toBe('The Show · 720 · on the mark');
    expect(stuntName({ course: 'wall', verdict: 'Something new', total: 10, facts: { jumped: true, crashed: true } })).toBe('The Wall · wrecked on landing');
    expect(stuntName({ course: 'show', verdict: 'Wrecked', total: 5, facts: { jumped: false, crashed: true } })).toBe('The Show · wrecked on the wall');
    expect(stuntName(null)).toBe('');
  });
  it('is pure: no DOM, storage, clock or randomness in the module', () => {
    const src = readFileSync(new URL('../../src/stunt-name.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\b(document|window|localStorage|Date\.now|Math\.random|performance)\b/);
  });
});
