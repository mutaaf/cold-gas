// 0204: a wreck isn't offered to the board. Post (and its "would be #N" and "Leave without posting?") is for the
// player's own decided board jump that didn't end in a crash; a landed run keeps it (0141).
import { describe, it, expect } from 'vitest';
import { postEligible } from '../../src/post.js';

const landed = { total: 88.4, verdict: 'Stuck it', facts: { jumped: true, crashed: false } };
const S = (over = {}) => ({ mode: 'results', runKind: 'jump', drill: null, autopilot: null, card: landed, ...over });

describe('postEligible (0204)', () => {
  it('offers Post on a landed board jump, on the sheet and in its replay', () => {
    expect(postEligible(S())).toBe(true);
    expect(postEligible(S({ mode: 'replay' }))).toBe(true);
  });

  it('never offers it on a crashed run, whatever its score', () => {
    expect(postEligible(S({ card: { total: 35.0, verdict: 'Wrecked', facts: { jumped: true, crashed: true } } }))).toBe(false);
    expect(postEligible(S({ card: { total: 41.2, verdict: 'Crash', facts: { jumped: true, crashed: true } } }))).toBe(false);
    expect(postEligible(S({ mode: 'replay', card: { total: 60, verdict: 'Crash', facts: { jumped: true, crashed: true } } }))).toBe(false);
    // A Wrecked verdict is a crash even if a card ever lacked the flag.
    expect(postEligible(S({ card: { total: 35.0, verdict: 'Wrecked', facts: { jumped: true } } }))).toBe(false);
  });

  it('keeps the old refusals: no jump, a zero, the reference, a drill, an autopilot, another screen', () => {
    expect(postEligible(S({ card: { total: 20, verdict: 'No jump', facts: { jumped: false, crashed: false } } }))).toBe(false);
    expect(postEligible(S({ card: { ...landed, total: 0 } }))).toBe(false);
    expect(postEligible(S({ card: null }))).toBe(false);
    expect(postEligible(S({ runKind: 'reveal' }))).toBe(false);
    expect(postEligible(S({ drill: { id: 'x' } }))).toBe(false);
    expect(postEligible(S({ autopilot: () => ({}) }))).toBe(false);
    for (const mode of ['title', 'live', 'countdown']) expect(postEligible(S({ mode }))).toBe(false);
  });
});
