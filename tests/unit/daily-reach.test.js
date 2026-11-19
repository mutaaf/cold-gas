// 0135: every Daily objective can be met by the players who fly its course the way they fly it (the Show and the Wall on
// one thumb, the Lineup too since 0181, Pro on the keys: scripts/lib/daily-reach.mjs). A small seeded sample of each
// population (n 40, seed 12345) flies every objective's course; each objective must be met by at least 30 % of it.
// scripts/daily-reach.mjs prints the full table (n 150).
import { describe, it, expect, beforeAll } from 'vitest';
import { reach, populationOf, HAND } from '../../scripts/lib/daily-reach.mjs';
import { OBJECTIVES } from '../../src/daily.js';

const FLOOR = 0.3;

describe('the Daily is in reach (0135)', () => {
  let rows;
  beforeAll(() => { rows = reach({ n: 40, seed: 12345 }); }, 300_000);   // 240 flights: ≈ 50 s alone

  it('measures every objective, each on its own population', () => {
    expect(rows.filter((r) => !r.form).map((r) => r.id)).toEqual(OBJECTIVES.map((o) => o.id));
    for (const r of rows) expect(r.n).toBe(40);
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'pro-wall'))).toBe('pro');
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'mark-lineup'))).toBe('thumb');   // 0181
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'gas-show'))).toBe('thumb');
  });

  it(`every objective is met by at least ${FLOOR * 100} % of the players who fly it`, () => {
    const low = rows.filter((r) => r.share < FLOOR).map((r) => `${r.id} ${r.met}/${r.n} (${r.population})`);
    expect(low).toEqual([]);
  });

  // 0218: a Lineup day by hand is its `hand` form, held to the floor above on the keys and on two thumbs; and on the keys
  // it is no gift either (the ticket's 30–70 % at n 150; this sample of 40 gets a little room on top).
  it('a Lineup day by hand: met by the keys and two thumbs, and not by every keys player', () => {
    const hand = rows.filter((r) => r.form === 'hand');
    expect(hand.map((r) => `${r.id} ${r.population}`).sort()).toEqual(['mark-lineup keys', 'mark-lineup touch', 'roll-lineup keys', 'roll-lineup touch']);
    expect(Object.keys(HAND).sort()).toEqual(['keys', 'touch']);
    for (const r of hand) {
      expect(r.n).toBe(40);
      expect(r.met, `${r.id} ${r.population}`).toBeGreaterThan(0);
      if (r.population === 'keys') expect(r.share).toBeLessThanOrEqual(0.75);
    }
  });

  it('the one-thumb mark, skim and 90+ days still leave some short: a better flight is still worth more (gas: 0200)', () => {
    // 0190: gas-show left out. LAND's hold now takes the drift off through the set-down, so a careful thumb's slide flies less
    // and the Show keeps more gas: "more than 25 % gas left" went 31/60 → 58/60 (n 60) and 40/40 here. The bar wants raising
    // (0200), not this flight made thirstier.
    for (const id of ['mark-show', 'skim-show', 'ninety-show']) expect(rows.find((r) => r.id === id).share).toBeLessThan(1);
    expect(rows.find((r) => r.id === 'gas-show').share).toBeGreaterThan(0.9);
  });
});
