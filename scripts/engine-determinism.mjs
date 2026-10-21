// Is the physics engine bit-exact across hosts? Runs the engine spike (scripts/engine-spike.js) in
// Node, Chromium, Firefox and WebKit and compares the hashes. The Worker leg runs separately
// (scripts/engine-worker/, `npx wrangler dev`), see docs/PHYSICS_ENGINE.md.
//   node scripts/engine-determinism.mjs
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { initPhysics, RAPIER } from '../src/sim/engine.js';
import { engineSpike } from './engine-spike.js';

await initPhysics();
const results = { node: engineSpike(RAPIER) };
const server = await createServer({ server: { port: 4398, strictPort: true }, logLevel: 'error' });
await server.listen();
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  try {
    const b = await type.launch();
    const p = await b.newPage();
    await p.goto('http://localhost:4398/coldgas/?gfx=low');
    results[name] = await p.evaluate(async () => {
      const { loadPhysics } = await import('/coldgas/src/sim/engine-web.js');
      const { RAPIER } = await import('/coldgas/src/sim/engine.js');
      const { engineSpike } = await import('/coldgas/scripts/engine-spike.js');
      await loadPhysics();
      return engineSpike(RAPIER);
    });
    await b.close();
  } catch (e) { results[name] = { error: e.message.split('\n')[0] }; }
}
await server.close();
let ok = true;
for (const [eng, r] of Object.entries(results)) {
  const same = r.hash === results.node.hash;
  if (!same && !r.error) ok = false;
  console.log(eng.padEnd(9), r.error ? `skipped (${r.error.slice(0, 70)})` : `${same ? 'IDENTICAL' : 'DIFFERS  '} ${r.hash} car ${r.car}`);
}
process.exit(ok ? 0 : 1);
