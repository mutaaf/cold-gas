// The Worker leg of the determinism check: replays the logs in Node and in workerd (a running
// `npx wrangler dev --config scripts/engine-worker/wrangler.jsonc --port 8931`) and compares the
// final state bit for bit, the engine spike's hash included.
//   node scripts/engine-worker/check.mjs <logs.json> [http://localhost:8931]
import { readFileSync } from 'node:fs';
import { initPhysics, RAPIER } from '../../src/sim/engine.js';
import { simulate } from '../../src/sim/run.js';
import { scoreRun } from '../../src/sim/judge.js';
import { engineSpike } from '../engine-spike.js';

await initPhysics();
const logs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const url = process.argv[3] || 'http://localhost:8931';
const node = { spike: engineSpike(RAPIER), runs: {} };
for (const [course, log] of Object.entries(logs)) {
  const run = simulate(log, course), c = run.car;
  node.runs[course] = { tick: run.tick, bits: [c.pos.x, c.pos.y, c.pos.z, c.quat.w, c.air, ...c.world.bodies.flatMap((b) => [b.cx, b.cy, b.cz, b.qw])].map((v) => v.toString()).join(','), total: scoreRun(run.t, { assist: true }).total };
}
const worker = await (await fetch(url, { method: 'POST', body: JSON.stringify(logs) })).json();
let ok = worker.spike.hash === node.spike.hash;
console.log('spike   ', ok ? 'IDENTICAL' : 'DIFFERS  ', 'node', node.spike.hash, 'worker', worker.spike.hash);
for (const course of Object.keys(logs)) {
  const a = node.runs[course], b = worker.runs[course];
  const same = a.bits === b.bits && a.tick === b.tick;
  if (!same) ok = false;
  console.log(course.padEnd(8), same ? 'IDENTICAL' : 'DIFFERS  ', 'total', a.total, b.total, 'tick', a.tick, b.tick);
}
process.exit(ok ? 0 : 1);
