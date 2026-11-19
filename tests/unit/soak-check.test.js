// 0302: the soak's verdict (scripts/soak-check.mjs, run by ios/scripts/soak.sh). Memory that settles passes, memory that
// climbs cycle after cycle fails, a fault fails, and a soak that never finished says so.
import { describe, it, expect } from 'vitest';
import { parseSoak, verdict, SOAK } from '../../scripts/soak-check.mjs';

const what = ['run-show', 'run-wall', 'run-lineup', 'roam-show', 'drive'];
function log(cycles, memOf, { faults = 0, done = true } = {}) {
  const lines = ['READY frame', 'PIPELINES built for show'];
  let step = 0;
  for (let c = 0; c < cycles; c++) for (let p = 0; p < 5; p++) { step++; lines.push(`SOAK step ${step} cycle ${c} ${what[p]} mem ${memOf(c, p)} faults ${faults}`); }
  if (done) lines.push(`SOAK done cycles ${cycles} steps ${step} mem first ${memOf(1, 0)} last ${memOf(cycles - 1, 4)} peak 999 faults ${faults}${faults ? ' · drive/error drive input not finite: let go' : ''}`);
  return lines.join('\n');
}

describe('soak-check', () => {
  it('reads the step and done lines', () => {
    const p = parseSoak(log(3, () => 400));
    expect(p.steps).toHaveLength(15);
    expect(p.steps[5]).toEqual({ step: 6, cycle: 1, what: 'run-show', mem: 400, faults: 0 });
    expect(p.done).toMatchObject({ cycles: 3, steps: 15, faults: 0 });
  });
  it('passes memory that settles after the first cycle', () => {
    const v = verdict(parseSoak(log(8, (c, p) => (c === 0 ? 250 + p * 40 : 430 + (p % 2) * 25))));
    expect(v.ok).toBe(true);
    expect(v.baseline).toBe(440); expect(v.end).toBe(440);
  });
  it('fails memory that climbs every cycle', () => {
    const v = verdict(parseSoak(log(8, (c) => 400 + c * 30)));
    expect(v.ok).toBe(false);
    expect(v.growth).toBe(180);
    expect(v.why.join()).toMatch(/memory grew 180 MB/);
  });
  it('lets a small or proportionally small rise pass', () => {
    expect(verdict(parseSoak(log(6, (c) => 400 + c * 10))).ok).toBe(true);        // 40 MB: under 64
    expect(verdict(parseSoak(log(6, (c) => 2000 + c * 20))).ok).toBe(true);       // 80 MB on 2 GB: under 20 %
    expect(SOAK.growthMb).toBe(64);
  });
  it('fails on any fault, and on a soak that never finished', () => {
    const f = verdict(parseSoak(log(4, () => 400, { faults: 1 })));
    expect(f.ok).toBe(false); expect(f.why.join()).toMatch(/1 fault\(s\) reported: drive\/error/);
    const cut = verdict(parseSoak(log(4, () => 400, { done: false })));
    expect(cut.ok).toBe(false); expect(cut.finished).toBe(false);
    expect(verdict(parseSoak(log(1, () => 400))).why.join()).toMatch(/too few cycles/);
  });
});
