// Can an ordinary player land the Wall with Assist? Simulate simple strategies a person would try.
import { createRun, stepRun, wallProgress } from '../src/sim/run.js';
import { newInput } from '../src/sim/vehicle.js';
import { scoreRun } from '../src/sim/judge.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)
const strategies = [];
for (const approach of [12, 17, 25, 40]) for (const climbThrottle of [0.5, 1]) for (const releaseAt of [0.6, 0.85, 0.97, 1.01]) strategies.push({ approach, climbThrottle, releaseAt });
let ok = 0;
for (const st of strategies) {
  const run = createRun('wall');
  let released = false;
  while (run.phase !== 'done') {
    const c = run.car, inp = newInput(); inp.assist = 1;
    const v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    inp.steer = Math.max(-1, Math.min(1, c.pos.x * 0.25));           // a person keeps it roughly straight
    if (run.phase === 'drive') { inp.throttle = v < st.approach ? 1 : 0; inp.fan = c.pos.z > -16 ? 1 : 0; }
    else if (run.phase === 'ramp' && !released) {
      inp.throttle = st.climbThrottle; inp.fan = 1;
      if (wallProgress(c.pos) >= st.releaseAt) released = true;
      if (released) inp.lift = 1;                                     // tap RELEASE
    } else if (run.phase === 'ramp' || run.phase === 'air') { inp.level = 1; }   // just hold LAND
    else inp.brake = 1;
    stepRun(run, inp);
  }
  const s = scoreRun(run.t, { assist: true }), t = run.t;
  const landed = t.settledUpright && !t.landedOnRamp && !t.fellOff && t.touchTick > 0;
  if (landed) ok++;
  console.log(JSON.stringify(st).padEnd(58), landed ? 'LANDED ' : 'crash  ', s.verdict.padEnd(22), String(s.total).padStart(5), 'height', s.facts.height ?? '-', 'sink', t.sink.toFixed(1), 'tilt', t.tiltDeg.toFixed(0), 'gas', s.facts.airPct, 'end', t.endReason);
}
console.log(`${ok}/${strategies.length} naive strategies landed upright`);
