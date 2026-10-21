// Input logs for the determinism checks (scripts/determinism.mjs, the Worker leg in
// scripts/engine-worker/): flights that lean on the engine — a clean reference, an Advanced run on
// the valves, and crashes that wake the parked bodies, shove them into each other and roll the car.
//   node scripts/engine-logs.mjs <dir>   → <dir>/clean.json, <dir>/crash.json ({ course: log })
import { writeFileSync, mkdirSync } from 'node:fs';
import { initPhysics } from '../src/sim/engine.js';
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';

await initPhysics();
const dir = process.argv[2] || '.';
mkdirSync(dir, { recursive: true });
const fly = (course, opts) => {
  const run = createRun(course), ap = createAutopilot(course, opts);
  while (run.phase !== 'done') stepRun(run, ap(run));
  return run.inputLog;
};
writeFileSync(`${dir}/clean.json`, JSON.stringify({ show: fly('show', { advanced: true }), wall: fly('wall'), lineup: fly('lineup') }));
writeFileSync(`${dir}/crash.json`, JSON.stringify({ show: fly('show', { carry: 5 }), wall: fly('wall', { releaseAt: 0.6 }), lineup: fly('lineup', { speed: 9, apex: 3.8, rolls: 2 }) }));
console.log('wrote', `${dir}/clean.json`, `${dir}/crash.json`);
