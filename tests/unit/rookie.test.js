// Rookie mode (0074, src/rookie.js): after three crashed runs in a row the results offer Easy driving +
// Assist flight in one tap. The streak's rules, pure.
import { describe, it, expect } from 'vitest';
import { isCrash, nextStreak, isRookie, offerRookie, loadStreak, saveStreak, ROOKIE_AFTER } from '../../src/rookie.js';
import { crashStep } from '../../src/ui.js';

const card = (facts, verdict = 'Clean') => ({ facts, verdict });
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe('a crash', () => {
  it('is what the timeline calls a crash, or the judge’s Wrecked', () => {
    for (const f of [{ crashed: true, endReason: 'flipped' }, { crashed: true, contact: true }, { crashed: true, fellOff: true }, { crashed: true }]) {
      expect(crashStep(card(f))).not.toBe('');
      expect(isCrash(card(f))).toBe(true);
    }
    expect(isCrash(card({ crashed: false }, 'Wrecked'))).toBe(true);
  });
  it('a clean end, a short one or no card at all is not', () => {
    for (const v of ['Stuck it', 'Rough landing', 'Short of the row', 'No climb']) {
      expect(crashStep(card({ crashed: false }, v))).toBe('');
      expect(isCrash(card({ crashed: false }, v))).toBe(false);
    }
    expect(isCrash(null)).toBe(false);
    expect(isCrash(undefined)).toBe(false);
  });
});

describe('the streak', () => {
  it('counts crashes in a row; a clean run ends it', () => {
    let n = 0;
    for (const c of [true, true]) n = nextStreak(n, c);
    expect(n).toBe(2);
    expect(offerRookie(n, 'standard', 'assist')).toBe(false);   // not on the second
    n = nextStreak(n, true);
    expect(n).toBe(ROOKIE_AFTER);
    expect(offerRookie(n, 'standard', 'assist')).toBe(true);    // the third
    n = nextStreak(n, true);
    expect(offerRookie(n, 'standard', 'assist')).toBe(true);    // and the fourth, the fifth…
    n = nextStreak(n, false);
    expect(n).toBe(0);
    expect(offerRookie(n, 'standard', 'assist')).toBe(false);
  });
  it('is never offered to a car already on Easy + Assist; any other mix gets it', () => {
    expect(isRookie('easy', 'assist')).toBe(true);
    expect(offerRookie(5, 'easy', 'assist')).toBe(false);
    expect(offerRookie(3, 'easy', 'pro')).toBe(true);
    expect(offerRookie(3, 'advanced', 'advanced')).toBe(true);
  });
  it('keeps for the session; blocked or junk storage is a fresh start, never a throw', () => {
    const s = memStore();
    expect(loadStreak(s)).toBe(0);
    saveStreak(4, s);
    expect(loadStreak(s)).toBe(4);
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
    expect(loadStreak(blocked)).toBe(0);
    expect(() => saveStreak(2, blocked)).not.toThrow();
    expect(loadStreak({ getItem: () => 'lots' })).toBe(0);
    expect(loadStreak({ getItem: () => '-3' })).toBe(0);
    expect(loadStreak(null)).toBe(0);
  });
});
