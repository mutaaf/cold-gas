import { describe, it, expect } from 'vitest';
import { createRun, logInput, quantise, INPUT_KEYS } from '../../src/sim/run.js';
import { newInput, clearInput } from '../../src/sim/vehicle.js';

// 0049: the input log is packed channel by channel into a reused Int16Array and compared in place. It must
// log exactly what the old `KEYS.map(round(q[k] * 100))` + string compare logged, and quantise exactly as
// the old per-key loop did: every replay and every server verification depends on it.
const oldQuantise = (raw, out) => { for (const k of INPUT_KEYS) out[k] = Math.round(Math.max(-1, Math.min(1, raw[k] || 0)) * 100) / 100; return out; };

describe('the input log (0049)', () => {
  // One difference, on purpose: a tiny negative that rounds to −0 now reaches the live sim as +0, as it
  // always did in a replay (run.js unpack: (n || 0) / 100), so the live run and its replay agree.
  it('quantises bit-identically to the per-key formula, odd inputs included (−0 is +0, as in a replay)', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2.4 - 1.2;
    const odd = [NaN, undefined, -0, 1e-9, 0.005, -0.005, 0.015, 0.125, -0.995, 1.5, -7, true];
    for (let i = 0; i < 4000; i++) {
      const raw = {};
      INPUT_KEYS.forEach((k, j) => { raw[k] = i < odd.length ? odd[(i + j) % odd.length] : rnd(); });
      const a = quantise(raw, newInput()), b = oldQuantise(raw, newInput());
      for (const k of INPUT_KEYS) expect(Object.is(a[k], b[k] === 0 ? 0 : b[k]), `${k} ${raw[k]}`).toBe(true);
    }
  });
  it('logs an entry only when the quantised input changes, with the same integers as before', () => {
    const run = createRun('show'), raw = newInput(), seen = [];
    let last = '';
    for (let t = 0; t < 600; t++) {
      clearInput(raw);
      raw.throttle = t < 200 ? 1 : 0.304;            // 0.304 and 0.3 quantise the same: no new entry
      if (t >= 300) raw.throttle = 0.3;
      if (t >= 400 && t < 410) raw.v3 = 0.5;
      raw.steer = t % 100 < 50 ? 0.004 : 0;           // under a hundredth: never logged
      const q = logInput(run, raw);
      const ints = INPUT_KEYS.map((k) => Math.round(q[k] * 100)), key = ints.join(',');
      if (key !== last) { seen.push([run.tick, ...ints]); last = key; }
      run.tick++;
    }
    expect(run.inputLog).toEqual(seen);
    expect(run.inputLog.map((e) => e[0])).toEqual([0, 200, 400, 410]);
    expect(run.inputLog[0]).toHaveLength(INPUT_KEYS.length + 1);
  });
  it('clearInput is newInput, written in place', () => {
    const a = newInput();
    for (const k of Object.keys(a)) a[k] = 0.7;
    expect(clearInput(a)).toEqual(newInput());
  });
});
