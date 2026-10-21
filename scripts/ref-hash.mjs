// Fingerprint of every reference run (final state bits + score), to show a physics change
// leaves the stunts bit-identical (or not).   node scripts/ref-hash.mjs
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { scoreRun } from '../src/sim/judge.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)

for (const course of ['show', 'wall', 'lineup']) {
  const run = createRun(course), ap = createAutopilot(course);
  while (run.phase !== 'done') stepRun(run, ap(run));
  const c = run.car;
  const bits = [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.vel.z, c.quat.w, c.air].map((v) => v.toPrecision(17)).join(',');
  let h = 0;
  for (let i = 0; i < bits.length; i++) h = (Math.imul(h, 31) + bits.charCodeAt(i)) | 0;
  console.log(course, 'ticks', run.tick, 'score', scoreRun(run.t).total, 'hash', (h >>> 0).toString(16));
}
