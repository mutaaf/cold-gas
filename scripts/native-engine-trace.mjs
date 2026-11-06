// The JS side of a native-port divergence hunt (docs/NATIVE.md §3): every value the car hands the engine (f32 bits) and
// the engine's answer, on ticks [a, b] of a run vector. The Swift side: CG_TRACE="<run> <a> <b>" swift test --filter TraceDebug.
//   node scripts/native-engine-trace.mjs <run> <a> <b>
import { readFileSync } from 'node:fs';
import { initPhysics } from '../src/sim/engine.js';
import { createRun, stepRun, INPUT_KEYS } from '../src/sim/run.js';
await initPhysics();
const [name, a, b] = [process.argv[2], +process.argv[3], +process.argv[4]];
const v = JSON.parse(readFileSync(`ios/Packages/ColdGasCore/Tests/Vectors/runs/${name}.json`, 'utf8'));
const run = createRun(v.course), rb = run.car.world.carRb;
const f = new Float32Array(1), u = new Uint32Array(f.buffer), h = (x) => { f[0] = x; return u[0].toString(16).padStart(8, '0'); };
const on = () => run.tick >= a && run.tick <= b;
for (const m of ['setTranslation', 'setRotation', 'setLinvel', 'setAngvel']) {
  const o = rb[m].bind(rb);
  rb[m] = (p, w) => { if (on()) console.log(run.tick, m, [p.x, p.y, p.z, p.w].filter((x) => x !== undefined).map(h).join(' ')); return o(p, w); };
}
const om = rb.setAdditionalMassProperties.bind(rb);
rb.setAdditionalMassProperties = (m, c, i, q, w) => { if (on()) console.log(run.tick, 'mass', h(m)); return om(m, c, i, q, w); };
const oc = run.car.world.carCol.setCollisionGroups.bind(run.car.world.carCol);
run.car.world.carCol.setCollisionGroups = (g) => { if (on()) console.log(run.tick, 'groups', g.toString(16)); return oc(g); };
const inp = {}; let li = 0;
while (run.phase !== 'done' && run.tick <= b) {
  while (li < v.log.length && v.log[li][0] <= run.tick) { INPUT_KEYS.forEach((k, i) => { inp[k] = (v.log[li][i + 1] || 0) / 100; }); li++; }
  stepRun(run, inp);
  if (on()) { const t = rb.translation(), r = rb.rotation(), lv = rb.linvel(), av = rb.angvel(); console.log(run.tick, 'out', [t.x, t.y, t.z, r.x, r.y, r.z, r.w, lv.x, lv.y, lv.z, av.x, av.y, av.z].map(h).join(' '), 'touch', run.car.world.carTouching); }
}
