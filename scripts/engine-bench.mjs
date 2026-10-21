// How fast is the sim on the engine? Ticks per second for each reference flight (the whole run:
// tyres, fan, jets, flight computer, the engine's step and contacts), in Node and in Chromium,
// plain and with a 4× CPU throttle (a mid-range phone, as scripts/perf-drive.mjs measures).
// Real time needs 240 ticks/s; the frame budget is what's left after rendering.
//   node scripts/engine-bench.mjs [--browser]
import { initPhysics } from '../src/sim/engine.js';
import { createRun, stepRun } from '../src/sim/run.js';
import { createAutopilot } from '../src/sim/autopilot.js';

await initPhysics();
function bench() {
  const out = {};
  for (const course of ['show', 'wall', 'lineup']) {
    const run = createRun(course), ap = createAutopilot(course);
    const t0 = performance.now();
    while (run.phase !== 'done') stepRun(run, ap(run));
    const s = (performance.now() - t0) / 1000;
    out[course] = { ticks: run.tick, ticksPerSec: Math.round(run.tick / s), msPerFrame60: +((4 / (run.tick / s)) * 1000).toFixed(3) };
  }
  return out;
}
bench();   // warm the JIT
console.log('node', JSON.stringify(bench()));

if (process.argv.includes('--browser')) {
  const { chromium } = await import('@playwright/test');
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 4397, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const b = await chromium.launch();
  for (const rate of [1, 4]) {
    const p = await b.newPage();
    await p.goto('http://localhost:4397/coldgas/?gfx=low');
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await p.evaluate(async () => {
      const { loadPhysics } = await import('/coldgas/src/sim/engine-web.js');
      const { createRun, stepRun } = await import('/coldgas/src/sim/run.js');
      const { createAutopilot } = await import('/coldgas/src/sim/autopilot.js');
      await loadPhysics();
      const out = {};
      for (let pass = 0; pass < 2; pass++) for (const course of ['show', 'wall', 'lineup']) {
        const run = createRun(course), ap = createAutopilot(course);
        const t0 = performance.now();
        while (run.phase !== 'done') stepRun(run, ap(run));
        const s = (performance.now() - t0) / 1000;
        out[course] = { ticksPerSec: Math.round(run.tick / s), msPerFrame60: +((4 / (run.tick / s)) * 1000).toFixed(3) };
      }
      return out;
    });
    console.log(`chromium ×${rate} CPU`, JSON.stringify(r));
    await p.close();
  }
  await b.close();
  await server.close();
}
