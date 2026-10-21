// The endless world's budget, measured: a phone profile (390×844, DPR 3, touch, CPU throttled 4×)
// or desktop, cruising the road at 250 km/h (no physics: the hardest case for streaming) or driving
// it with the autopilot. Reports FPS and frame times, the main thread's own ms per frame (the drive
// loop and the world's streaming), the worker's ms per tile, memory, and whether generation ever
// fell behind (the full-detail tile or the road chunk under the car missing).
//   node scripts/perf-endless.mjs [url] [phone|desktop] [cruise|drive] [seconds] [seed] [gfx]
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4377/coldgas/', profile = 'phone', mode = 'cruise', secs = '40', seed = 'cold-gas', gfx] = process.argv.slice(2);
const phone = profile === 'phone';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (phone) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}
const t0 = Date.now();
await page.goto(`${url}?drive=endless&seed=${encodeURIComponent(seed)}&idb=0${gfx ? `&gfx=${gfx}` : ''}`);
await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 180000 });
const loadS = (Date.now() - t0) / 1000;
const res = await page.evaluate(async ([mode, secs]) => {
  const d = window.__coldgas.drive;
  // Time the drive loop (physics, camera, HUD and the world's update) every frame.
  const frame = d.frame, loop = [];
  d.frame = (dt, time) => { const a = performance.now(); frame(dt, time); loop.push(performance.now() - a); };
  if (mode === 'cruise') d.cruise(250 / 3.6); else d.autopilot(true, { vmax: 70 });
  await new Promise((r) => setTimeout(r, 1500));
  loop.length = 0;
  const dts = [], miss = { terrain: 0, road: 0, frames: 0 };
  let last = performance.now();
  const s0 = d.stats().i;
  await new Promise((resolve) => {
    const end = last + secs * 1000;
    const tick = (now) => {
      dts.push(now - last); last = now;
      const c = d.car, cov = d.world.coverage(c.pos.x, c.pos.z, d.stats().i);
      miss.frames++; if (!cov.terrain) miss.terrain++; if (!cov.road) miss.road++;
      if (now < end) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  d.frame = frame;
  // One frame's draw calls and triangles (the composer resets the counters between its passes).
  const info = window.__coldgas.stage.renderer.info;
  info.autoReset = false; info.reset();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  info.reset();
  await new Promise((r) => requestAnimationFrame(r));
  const calls = info.render.calls, triangles = info.render.triangles;
  info.autoReset = true;
  const st = d.stats();
  return {
    dts, loop, miss, km: ((st.i - s0) * 3) / 1000, st,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    gl: { geometries: info.memory.geometries, textures: info.memory.textures, calls, triangles },
  };
}, [mode, Number(secs)]);
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const s = res.st;
console.log(`endless [${profile}${gfx ? ` gfx=${gfx}` : ''}, ${mode}${mode === 'cruise' ? ' 250 km/h' : ''}] seed ${seed} · load ${loadS.toFixed(1)} s · ${res.km.toFixed(2)} km in ${secs} s`);
console.log(`  fps ${(1000 / avg(res.dts)).toFixed(1)} avg · frame p50 ${pct(res.dts, 0.5).toFixed(1)} ms · p95 ${pct(res.dts, 0.95).toFixed(1)} · p99 ${pct(res.dts, 0.99).toFixed(1)}`);
console.log(`  main thread (drive loop incl. world): avg ${avg(res.loop).toFixed(2)} ms/frame · p95 ${pct(res.loop, 0.95).toFixed(2)} · max ${Math.max(...res.loop).toFixed(1)}; world.update p50 ${s.main.p50Ms} · p95 ${s.main.p95Ms} · max ${s.main.maxMs} ms`);
console.log(`  worker: ${s.worker.built} tiles · avg ${s.worker.avgMs} ms/tile · p95 ${s.worker.p95Ms} · max ${s.worker.maxMs} (lru hits ${s.worker.fromLru}); road chunks: ${s.chunkWorker.built} built in the worker, avg ${s.chunkWorker.avgMs} ms · max ${s.chunkWorker.maxMs}; main-thread upload max ${s.main.chunkUploadMaxMs} ms`);
console.log(`  memory: JS heap ${res.heapMB} MB · world GPU ${s.gpuMB} MB · tile cache ${s.cacheMB} MB · GL geometries ${res.gl.geometries} · textures ${res.gl.textures}`);
console.log(`  scene: draw calls ${res.gl.calls} · triangles ${(res.gl.triangles / 1000).toFixed(0)}k · tiles ${s.tiles.join('/')} · chunks ${s.chunks} · veg ${JSON.stringify(s.veg)}`);
console.log(`  fell behind: ${res.miss.terrain}/${res.miss.frames} frames without full-detail ground under the car, ${res.miss.road}/${res.miss.frames} without its road chunk`);
console.log('errors:', errors.slice(0, 5).join(' | ') || 'none');
await browser.close();
