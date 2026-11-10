// 0135: every Daily objective can be met by the players who fly its course the way they fly it (the Show and the Wall on
// one thumb, the Lineup too since 0181, Pro on the keys: scripts/lib/daily-reach.mjs). A small seeded sample of each
// population (n 40, seed 12345) flies every objective's course; each objective must be met by at least 30 % of it.
// scripts/daily-reach.mjs prints the full table (n 150).
import { describe, it, expect, beforeAll } from 'vitest';
import { reach, populationOf } from '../../scripts/lib/daily-reach.mjs';
import { OBJECTIVES } from '../../src/daily.js';

const FLOOR = 0.3;

describe('the Daily is in reach (0135)', () => {
  let rows;
  beforeAll(() => { rows = reach({ n: 40, seed: 12345 }); }, 240_000);   // 160 flights: ≈ 35 s alone

  it('measures every objective, each on its own population', () => {
    expect(rows.map((r) => r.id)).toEqual(OBJECTIVES.map((o) => o.id));
    for (const r of rows) expect(r.n).toBe(40);
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'pro-wall'))).toBe('pro');
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'mark-lineup'))).toBe('thumb');   // 0181
    expect(populationOf(OBJECTIVES.find((o) => o.id === 'gas-show'))).toBe('thumb');
  });

  it(`every objective is met by at least ${FLOOR * 100} % of the players who fly it`, () => {
    const low = rows.filter((r) => r.share < FLOOR).map((r) => `${r.id} ${r.met}/${r.n} (${r.population})`);
    expect(low).toEqual([]);
  });

  it('the one-thumb mark, gas, skim and 90+ days still leave some short: a better flight is still worth more', () => {
    for (const id of ['mark-show', 'gas-show', 'skim-show', 'ninety-show']) expect(rows.find((r) => r.id === id).share).toBeLessThan(1);
  });
});
