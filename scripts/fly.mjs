// Dev harness: fly the reveal autopilot headless and print the telemetry.
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
const opts = JSON.parse(process.argv[2] || '{}');
const run = createRun(); const ap = createAutopilot(opts);
let lastPhase = '';
while (run.phase !== 'done') {
  stepRun(run, ap(run));
  if (run.phase !== lastPhase || run.tick % 120 === 0) {
    const c = run.car;
    console.log(run.tick, run.phase.padEnd(7), 'pos', c.pos.x.toFixed(2), c.pos.y.toFixed(2), c.pos.z.toFixed(2), 'v', Math.hypot(c.vel.x,c.vel.y,c.vel.z).toFixed(1), 'air', c.air.toFixed(0), 'g', c.grounded, 'roll', (run.t.rollAccum*57.3).toFixed(0));
    lastPhase = run.phase;
  }
}
const { frames, ...rest } = run.t; console.log(JSON.stringify(run.t, null, 0));
