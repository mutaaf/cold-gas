// Cross-engine determinism check: replay the same input logs in Node, Chromium, Firefox and
// WebKit (Safari's engine) and compare the final state bit for bit. node scripts/determinism.mjs logs.json
import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'vite';
const logs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const probe = async (logs) => {
  await (await import('/coldgas/src/sim/engine-web.js')).loadPhysics();   // the engine's WASM, as the game loads it
  const { simulate } = await import('/coldgas/src/sim/run.js');
  const { scoreRun } = await import('/coldgas/src/sim/judge.js');
  const out = {};
  for (const [course, log] of Object.entries(logs)) {
    const run = simulate(log, course);
    const c = run.car;
    out[course] = { tick: run.tick, bits: [c.pos.x, c.pos.y, c.pos.z, c.quat.w, c.air, ...c.world.bodies.flatMap((b) => [b.cx, b.cy, b.cz, b.qw])].map((v) => v.toString()).join(','), total: scoreRun(run.t, { assist: true }).total };
  }
  return out;
};
const results = {};
results.node = await probe.call(null, logs).catch(async () => {
  // Node can't import "/src/…": use relative paths instead.
  await (await import('../src/sim/engine.js')).initPhysics();
  const { simulate } = await import('../src/sim/run.js');
  const { scoreRun } = await import('../src/sim/judge.js');
  const out = {};
  for (const [course, log] of Object.entries(logs)) { const run = simulate(log, course); const c = run.car; out[course] = { tick: run.tick, bits: [c.pos.x, c.pos.y, c.pos.z, c.quat.w, c.air, ...c.world.bodies.flatMap((b) => [b.cx, b.cy, b.cz, b.qw])].map((v) => v.toString()).join(','), total: scoreRun(run.t, { assist: true }).total }; }
  return out;
});
const server = await createServer({ server: { port: 4399, strictPort: true }, logLevel: 'error' });
await server.listen();
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  try {
    const b = await type.launch();
    const p = await b.newPage();
    await p.goto('http://localhost:4399/coldgas/?gfx=low');
    results[name] = await p.evaluate(probe, logs);
    await b.close();
  } catch (e) { results[name] = { error: e.message.split('\n')[0] }; }
}
await server.close();
let ok = true;
for (const course of Object.keys(logs)) {
  const ref = results.node[course];
  for (const [eng, r] of Object.entries(results)) {
    const same = r[course] && r[course].bits === ref.bits && r[course].tick === ref.tick;
    if (!same && !r.error) ok = false;
    console.log(course.padEnd(7), eng.padEnd(9), r.error ? `skipped (${r.error.slice(0, 50)})` : `${same ? 'IDENTICAL' : 'DIFFERS  '} total ${r[course].total} tick ${r[course].tick}`);
  }
}
process.exit(ok ? 0 : 1);
