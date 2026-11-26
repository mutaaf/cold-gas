// Can an ordinary keyboard player land the Lineup with Assist (0362)? The grid in scripts/lib/naive-lineup.mjs: run-up
// 6 / 7.5 / 9 m/s, Space pressed at z −6…+1 and held 0.3–3 s, a roll of 0, 0.8 or 1.4 s, then LAND. Prints each flight
// and the count that land upright and unwrecked. `node scripts/naive-lineup.mjs [simVersion]` (33: before the lift-off burn).
import { initPhysics } from '../src/sim/engine.js';
import { flyNaive, grid } from './lib/naive-lineup.mjs';
await initPhysics();
const v = process.argv[2] ? +process.argv[2] : undefined;
let ok = 0, n = 0;
const byHold = {};
for (const p of grid()) {
  const r = flyNaive({ ...p, simVersion: v });
  n++; if (r.landed) ok++;
  (byHold[p.liftS] ||= [0, 0])[r.landed ? 0 : 1]++;
  console.log(JSON.stringify(p).padEnd(52), r.landed ? 'LANDED' : 'crash ', r.verdict.padEnd(14), String(r.total).padStart(5), 'apex', r.apex.toFixed(1), 'sink', r.sink.toFixed(1), 'end', r.end);
}
console.log(`${ok}/${n} land upright and unwrecked`);
console.log('by hold s [landed, not]', JSON.stringify(byHold));
