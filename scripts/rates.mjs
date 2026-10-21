import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';
import { bodyRates, up } from '../src/sim/vehicle.js';
import { initPhysics } from '../src/sim/engine.js';
await initPhysics();   // the rigid-body engine's WASM (src/sim/engine.js)
const run = createRun(); const ap = createAutopilot(JSON.parse(process.argv[2]||'{}'));
const w={x:0,y:0,z:0}, u={x:0,y:0,z:0};
while (run.phase !== 'done' && run.tick < 4000) {
  const inp = ap(run); stepRun(run, inp);
  if (run.phase==='air' && run.tick%12===0) { bodyRates(run.car,w); up(run.car,u);
    console.log(run.tick, 'in r',inp.roll,'lvl',inp.level,'lift',inp.lift, 'w', w.x.toFixed(2), w.y.toFixed(2), w.z.toFixed(2), 'up', u.x.toFixed(2),u.y.toFixed(2),u.z.toFixed(2), 'roll', (run.t.rollAccum*57.3).toFixed(0), 'thr', Array.from(run.car.throttles).map(x=>x.toFixed(1)).join(' ')); }
}
