// The set-down after each reference flight (ticket 0014): from upright (after the roll) to the
// wheels, lift-off to touchdown, time below 3 m, gas, sink, where it lands. node scripts/setdown-probe.mjs [courses]
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { scoreRun } from '../src/sim/judge.js';
import { COURSES } from '../src/sim/courses.js';
import { up } from '../src/sim/vehicle.js';
import { SPEC } from '../src/sim/spec.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();

export function probe(course, opts = {}) {
  const run = createRun(course), ap = createAutopilot(course, opts), u = { x: 0, y: 0, z: 0 };
  let release = -1, tipped = false, upright = -1, below3 = 0, airGas = -1, air0 = null, peakSink = 0;
  while (run.phase !== 'done') {
    const inp = ap(run);
    if (release < 0 && run.phase !== 'drive' && inp.fan === 0) release = run.tick;
    stepRun(run, inp);
    const c = run.car;
    up(c, u);
    if (run.phase === 'air' && air0 === null) { air0 = { x: c.pos.x, z: c.pos.z }; airGas = c.air; }
    if (run.t.touchTick < 0 || run.tick <= run.t.touchTick) {
      if (u.y < 0.5) tipped = true;
      if (tipped && upright < 0 && u.y > 0.95) upright = run.tick;
      if (run.phase === 'air') {
        if (c.pos.y - SPEC.comHeight < 3) below3++;
        peakSink = Math.max(peakSink, -c.vel.y);
      }
      if (run.tick === run.t.touchTick) {
        run._touch = { x: c.pos.x, z: c.pos.z, gas: c.air };
      }
    }
  }
  const t = run.t, card = scoreRun(t), pad = COURSES[course].pad, at = run._touch;
  return {
    course,
    airtime: +((t.touchTick - t.airStartTick) / 240).toFixed(2),
    releaseToWheels: release > 0 ? +((t.touchTick - release) / 240).toFixed(2) : null,
    uprightToWheels: upright > 0 ? +((t.touchTick - upright) / 240).toFixed(2) : null,
    below3: +(below3 / 240).toFixed(2),
    dist: air0 && at ? +Math.hypot(at.x - air0.x, at.z - air0.z).toFixed(1) : null,
    gas: at ? +(airGas - at.gas).toFixed(0) : null,
    touchZ: at ? +at.z.toFixed(1) : null, padZ: pad.z, offMark: at ? +Math.hypot(at.x - pad.x, at.z - pad.z).toFixed(2) : null,
    restZ: +run.car.pos.z.toFixed(1),
    sink: +t.sink.toFixed(2), peakSink: +peakSink.toFixed(1), brakePeakG: +(t.brakePeakG ?? 0).toFixed(2),
    total: card.total, verdict: card.verdict, contact: t.contact,
  };
}
const list = (process.argv[2] || 'lineup,wall,show').split(',');
for (const c of list) console.log(JSON.stringify(probe(c)));
