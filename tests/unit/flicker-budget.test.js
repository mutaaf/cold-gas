import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { flatten, compare, lowered } from '../../scripts/flicker-budget.mjs';

// The flicker gate (0050): a flicker.mjs run against docs/flicker-budget.json.
const region = (pops) => ({ jitter: 1, popsPerMille: pops, share: 0.1 });

describe('flicker budget', () => {
  it('flattens scenarios, regions and the z-fight probes into one key per number', () => {
    const f = flatten({
      'show-wide': { wall: region(4), car: region(10) },
      'drive-road': null,
      nudgeJets: { meanDelta: 0.1, popsPerMille: 0.3, perPose: [] },
      nudge: { show: { meanDelta: 0.1, popsPerMille: 1.2, perPose: [] }, jets: { popsPerMille: 0.3 } },
    });
    expect(f).toEqual({ 'show-wide/wall': 4, 'show-wide/car': 10, 'nudge/jets': 0.3, 'nudge/show': 1.2 });
  });

  it('passes within 25 %, fails above it, and gives near-zero regions an absolute floor', () => {
    const budget = { 'show-wide/car': 10, 'show-wide/sky': 0.2 };
    expect(compare({ 'show-wide': { car: region(12.4), sky: region(0.6) } }, budget).pass).toBe(true);
    const over = compare({ 'show-wide': { car: region(12.6), sky: region(0.6) } }, budget);
    expect(over.pass).toBe(false);
    expect(over.rows.find((r) => r.status === 'over').key).toBe('show-wide/car');
    expect(compare({ 'show-wide': { car: region(10), sky: region(0.8) } }, budget).pass).toBe(false);
  });

  it('a scenario the run skipped is reported, not failed; a new region is reported, not failed', () => {
    const { rows, pass } = compare({ 'show-wide': { car: region(1), row: region(50) } }, { 'show-wide/car': 10, 'show-title/wall': 3 });
    expect(pass).toBe(true);
    expect(rows.find((r) => r.key === 'show-title/wall').status).toBe('missing');
    expect(rows.find((r) => r.key === 'show-wide/row').status).toBe('new');
  });

  it('a region gone from a scenario that ran fails the gate', () => {
    const { rows, pass } = compare({ 'show-wide': { wall: region(4) } }, { 'show-wide/wall': 4, 'show-wide/car': 10 });
    expect(pass).toBe(false);
    expect(rows.find((r) => r.key === 'show-wide/car').status).toBe('gone');
  });

  it('a budget file without tolerance or floor keeps the defaults (the gate is never off)', () => {
    const budget = { 'show-wide/car': 10 };
    expect(compare({ 'show-wide': { car: region(13) } }, budget, { tolerance: undefined, floor: undefined }).pass).toBe(false);
    expect(compare({ 'show-wide': { car: region(12) } }, budget, {}).pass).toBe(true);
  });

  it('--write lowers and adds, and raises only when told', () => {
    const run = { 'show-wide': { car: region(8), wall: region(9) }, 'drive-road': { sky: region(1) } };
    expect(lowered({ 'show-wide/car': 10, 'show-wide/wall': 5 }, run)).toEqual({ 'show-wide/car': 8, 'show-wide/wall': 5, 'drive-road/sky': 1 });
    expect(lowered({ 'show-wide/wall': 5 }, run, { raise: true })['show-wide/wall']).toBe(9);
    expect(lowered(undefined, run)).toEqual({ 'show-wide/car': 8, 'show-wide/wall': 9, 'drive-road/sky': 1 });
  });

  it('the committed budget covers every scenario on the GPU-free label, the new ones included', () => {
    const doc = JSON.parse(readFileSync('docs/flicker-budget.json', 'utf8'));
    for (const label of ['chromium-swiftshader desktop', 'chromium-swiftshader phone']) {
      const scenarios = new Set(Object.keys(doc.budgets[label]).map((k) => k.split('/')[0]));
      for (const s of ['show-title', 'show-approach', 'show-wide', 'show-replay', 'show-replay-rigs', 'show-jets',
        'show-live-jets', 'retry-countdown', 'lineup-title', 'lineup-approach', 'drive-road', 'endless-cruise', 'nudge'])
        expect(scenarios, `${label}: ${s}`).toContain(s);
    }
    expect(doc.tolerance).toBe(0.25);
  });
});
