// Fly a reference run headless and print the timeline + telemetry. node scripts/fly.mjs [wall|lineup] '{"climb":12}'
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { up } from '../src/sim/vehicle.js';
const course = process.argv[2] || 'wall', opts = JSON.parse(process.argv[3] || '{}');
const run = createRun(course); const ap = createAutopilot(course, opts);
let lastPhase = ''; const u = {};
while (run.phase !== 'done') {
  stepRun(run, ap(run));
  const c = run.car;
  if (run.phase !== lastPhase || (run.phase !== 'drive' && run.tick % 60 === 0)) {
    up(c, u);
    console.log((run.tick / 240).toFixed(2), run.phase.padEnd(6), 'pos', c.pos.x.toFixed(2), c.pos.y.toFixed(2), c.pos.z.toFixed(2), 'v', Math.hypot(c.vel.x, c.vel.y, c.vel.z).toFixed(1), 'vy', c.vel.y.toFixed(1), 'upY', u.y.toFixed(2), 'gas', c.air.toFixed(0), 'fan', (c.fanForce / 1000).toFixed(0) + 'k', 'g', c.grounded, 'roll', (run.t.rollAccum * 57.3).toFixed(0));
    lastPhase = run.phase;
  }
}
const { wheelTouch, ...rest } = run.t;
console.log(JSON.stringify(rest));
