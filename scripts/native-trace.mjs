// The JS side of a native-port divergence hunt: the car's state per tick on [a, b] of a run vector (diff against TraceDebug).
//   node scripts/native-trace.mjs <run> <a> <b>
import { readFileSync } from 'node:fs';
import { initPhysics } from '../src/sim/engine.js';
import { simulate } from '../src/sim/run.js';
import { hex } from './vectors-lib.mjs';
await initPhysics();
const [name, a, b] = [process.argv[2], +process.argv[3], +process.argv[4]];
const v = JSON.parse(readFileSync(`ios/Packages/ColdGasCore/Tests/Vectors/runs/${name}.json`, 'utf8'));
simulate(v.log, v.course, undefined, (r) => {
  if (r.tick < a || r.tick > b) return;
  const c = r.car;
  console.log(r.tick, [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.vel.z, c.angVel.x, c.angVel.y, c.angVel.z, c.air].map(hex).join(' '),
    'g' + c.grounded, 'touch' + c.world.carTouching, 'held' + (c.engineHeld ? 1 : 0), 'hc' + (c.hullContact ? 1 : 0), 'curl' + (c.world.curlOn ? 1 : 0));
});
