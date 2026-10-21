// Input logs for the determinism checks (scripts/determinism.mjs, the Worker leg in
// scripts/engine-worker/): flights that lean on the engine — a clean reference, an Advanced run on
// the valves, and crashes that wake the parked bodies, shove them into each other and roll the car;
// and drives out to the launch complex (its solids streamed in, the static fire's jet on the car).
//   node scripts/engine-logs.mjs <dir>   → <dir>/clean.json, <dir>/crash.json, <dir>/site.json ({ course: log })
import { writeFileSync, mkdirSync } from 'node:fs';
import { initPhysics } from '../src/sim/engine.js';
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { siteOf, toWorld, PLUME, TOWER_X } from '../src/sim/complex.js';
import { datan2, dhypot } from '../src/sim/dmath.js';

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
// Out to the complex: steer through waypoints in its frame at up to 25 m/s, brake at the last one
// (`stop`) or drive on into whatever is there, and hold the input until `secs`.
const drive = (course, points, secs, stop = true) => {
  const run = createRun(course), c = run.car, site = siteOf(course), aims = points.map(([x, z]) => toWorld(site, x, 0, z));
  let i = 0;
  while (run.phase !== 'done' && run.tick < secs * 240) {
    const aim = aims[i], last = i === aims.length - 1;
    const hdg = datan2(2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), 1 - 2 * (c.quat.x * c.quat.x + c.quat.y * c.quat.y));
    let e = datan2(aim.x - c.pos.x, aim.z - c.pos.z) - hdg;
    e = e > Math.PI ? e - 2 * Math.PI : e < -Math.PI ? e + 2 * Math.PI : e;
    const d = dhypot(aim.x - c.pos.x, aim.z - c.pos.z), v = dhypot(c.vel.x, c.vel.z);
    if (!last && d < 8) i++;
    const near = last && stop && d < 2 + (v * v) / 12;
    stepRun(run, { throttle: !near && v < 25 ? 1 : 0, brake: near ? 1 : 0, steer: near ? 0 : Math.max(-1, Math.min(1, -2 * e)), assist: 1 });
  }
  return run.inputLog;
};
// The Show: round the pad's west side and park 12 m down the flame trench's jet through the first
// static fire (20 s); it is blown off the pad. The Wall: driven flat out at the strongback (a column
// of the launch mount stands in the way).
writeFileSync(`${dir}/site.json`, JSON.stringify({
  show: drive('show', [[-20, 40], [-20, -45], [PLUME.exit[0], PLUME.exit[2] - 12]], 30),
  wall: drive('wall', [[TOWER_X, -30]], 24, false),
}));
console.log('wrote', `${dir}/clean.json`, `${dir}/crash.json`, `${dir}/site.json`);
