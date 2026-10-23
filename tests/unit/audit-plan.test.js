import { describe, it, expect } from 'vitest';
import { planShards, planLoad, viewportsFor, vpBase, cost, TITLE_COST } from '../../scripts/audit-plan.mjs';

// Ticket 0083: the audit gate's shards are balanced by estimated cost (scripts/audit-plan.mjs), so no
// CI job runs into its timeout while another idles; every viewport and the title audit run exactly once.
describe('audit shard plan', () => {
  const all = viewportsFor('all');

  it('flies every viewport, and the title audit, exactly once, whatever the shard count', () => {
    for (const M of [1, 2, 3, 4, 5, 6, 8]) {
      const plan = planShards(all, M);
      expect(plan).toHaveLength(M);
      const flat = plan.flat().map((v) => (v === 'title' ? 'title' : vpBase(v)));
      expect(flat.filter((v) => v === 'title')).toHaveLength(1);
      expect(flat.filter((v) => v !== 'title').sort()).toEqual(all.map(vpBase).sort());
    }
  });

  it('keeps every shard within 1.5× of every other (estimated), from 3 shards to 6', () => {
    for (const M of [3, 4, 5, 6]) {
      const loads = planShards(all, M).map(planLoad);
      expect(Math.max(...loads) / Math.min(...loads)).toBeLessThan(1.5);
    }
  });

  it('is deterministic, and keeps each shard in the listed order', () => {
    expect(planShards(all, 6)).toEqual(planShards(all, 6));
    for (const s of planShards(all, 6)) {
      const idx = s.filter((v) => v !== 'title').map((v) => all.indexOf(v));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it('costs what a runner spends: a big desktop over a small phone, Free Drive extra, the title as one item', () => {
    expect(cost([1920, 1080])).toBeGreaterThan(2 * cost([320, 568]));
    expect(cost([390, 844])).toBeGreaterThan(cost([430, 932]));   // 390×844 also flies Free Drive
    expect(cost('title')).toBe(TITLE_COST);
  });
});
