#!/usr/bin/env node
// The observability layer's per-frame cost: obs.frame (ring + histogram + window + governor), and the
// heal wrapper's own timing calls, measured over a million frames in Node. Run with --expose-gc for
// the allocation figure:  node --expose-gc scripts/obs-bench.mjs
import { obs } from '../src/obs/index.js';
import { createGovernor } from '../src/obs/ledger.js';

obs.governor = process.env.NOGOV ? null : createGovernor();
const N = 1_000_000;
const run = (fn) => { for (let i = 0; i < 50_000; i++) fn(i); globalThis.gc?.(); const h0 = process.memoryUsage().heapUsed, t0 = performance.now(); for (let i = 0; i < N; i++) fn(i); return { ns: ((performance.now() - t0) / N) * 1e6, kb: (process.memoryUsage().heapUsed - h0) / 1024 }; };

const clock = new Float64Array(1);   // not a boxed local: the browser hands rAF its own timestamp
const frame = run((i) => { clock[0] += 16.7; obs.frame(clock[0], 16 + (i & 7), 2, 4, 7, 0); });
// What heal.frame adds around the body: three performance.now() calls and a try/catch.
const body = () => {};
const wrap = run(() => { const t0 = performance.now(); try { body(); } catch { /* */ } const r = performance.now(); void (performance.now() - t0 + r); });
console.log(`obs.frame        ${frame.ns.toFixed(1)} ns/frame, heap ${frame.kb >= 0 ? '+' : ''}${frame.kb.toFixed(0)} kB over ${N.toLocaleString('en-US')} frames`);
console.log(`heal wrapper     ${wrap.ns.toFixed(1)} ns/frame, heap ${wrap.kb >= 0 ? '+' : ''}${wrap.kb.toFixed(0)} kB`);
console.log(`total            ${(frame.ns + wrap.ns).toFixed(1)} ns/frame = ${(((frame.ns + wrap.ns) / 1e6) / 16.7 * 100).toFixed(4)} % of a 60 Hz frame`);
