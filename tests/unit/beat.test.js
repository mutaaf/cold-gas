// The landing's beat (0199, src/beat.js): which runs get it, and its timeline, pure. The numbers it shows are
// the card's; the beat only decides when each one is on screen.
import { describe, it, expect } from 'vitest';
import { BEAT, beatAt, beatEligible } from '../../src/beat.js';

const card = (over = {}) => ({ total: 87.3, verdict: 'Stuck it', facts: { jumped: true, crashed: false }, judges: [], ...over });
const own = (c) => ({ card: c, autopilot: null, drill: null, runKind: 'jump' });

describe('which runs get the beat', () => {
  it('a landed jump of the player’s own', () => {
    expect(beatEligible(own(card()))).toBe(true);
    expect(beatEligible(own(card({ verdict: 'Short of the row', total: 41.2 })))).toBe(true);
  });
  it('never a wreck, a crash, a run that never jumped, the reference, a drill or no card', () => {
    expect(beatEligible(own(card({ facts: { jumped: true, crashed: true } })))).toBe(false);
    expect(beatEligible(own(card({ verdict: 'Wrecked' })))).toBe(false);
    expect(beatEligible(own(card({ facts: { jumped: false, crashed: false } })))).toBe(false);
    expect(beatEligible(own(card({ total: 0 })))).toBe(false);
    expect(beatEligible({ ...own(card()), autopilot: () => ({}) })).toBe(false);
    expect(beatEligible({ ...own(card()), drill: { id: 'ledge' } })).toBe(false);
    expect(beatEligible({ ...own(card()), runKind: 'reveal' })).toBe(false);
    expect(beatEligible(own(null))).toBe(false);
  });
});

describe('the timeline', () => {
  it('counts up from zero, never past the card, and lands exactly on its total', () => {
    let last = -1;
    for (let t = 0; t <= BEAT.len + 0.01; t += 1 / 60) {
      const s = beatAt(t, 87.3);
      expect(s.tenths).toBeGreaterThanOrEqual(last);
      expect(s.tenths).toBeLessThanOrEqual(873);
      last = s.tenths;
    }
    expect(beatAt(0, 87.3).tenths).toBe(0);
    expect(beatAt(BEAT.countAt + BEAT.countLen, 87.3)).toMatchObject({ tenths: 873, landed: true });
    expect(beatAt(BEAT.countAt + BEAT.countLen - 0.05, 87.3).landed).toBe(false);
  });
  it('the judges go up one by one after the score has landed, then the beat ends', () => {
    expect(BEAT.judgeAt[0]).toBeGreaterThan(BEAT.countAt + BEAT.countLen);
    expect(beatAt(BEAT.judgeAt[0] - 0.01, 90).judges).toBe(0);
    expect(beatAt(BEAT.judgeAt[0], 90).judges).toBe(1);
    expect(beatAt(BEAT.judgeAt[1], 90).judges).toBe(2);
    expect(beatAt(BEAT.judgeAt[2], 90).judges).toBe(3);
    expect(beatAt(BEAT.len - 0.01, 90).done).toBe(false);
    expect(beatAt(BEAT.len, 90).done).toBe(true);
    expect(BEAT.len).toBeGreaterThanOrEqual(2);
    expect(BEAT.len).toBeLessThanOrEqual(2.5);
  });
  it('reduced motion: no count, the final numbers on the first frame, a short hold', () => {
    expect(beatAt(0, 64.6, true)).toEqual({ tenths: 646, judges: 3, landed: true, done: false });
    expect(beatAt(BEAT.quietLen, 64.6, true).done).toBe(true);
    expect(BEAT.quietLen).toBeLessThan(BEAT.len);
  });
  it('a tap is held off for a moment, so a thumb still down from the landing doesn’t skip it', () => {
    expect(BEAT.guard).toBeGreaterThan(0.2);
    expect(BEAT.guard).toBeLessThan(BEAT.countAt + BEAT.countLen);
  });
});
