// First-load performance probe (cold cache), the numbers behind "time to first paint".
//
//   node scripts/perf.mjs <url> [label] [runs]
//   node scripts/serve-gz.mjs dist/coldgas 4701 & node scripts/perf.mjs http://localhost:4701/coldgas/ local 3
//     (after a build; served gzipped like production: `vite preview` sends raw bytes, so the Slow 4G profile would
//     time 731 kB of entry instead of ≈ 220 kB)
//   node scripts/perf.mjs https://mutaafaziz.com/coldgas/ prod 3
//   CHROMIUM=/path/to/chrome node scripts/perf.mjs …   (a browser other than Playwright's own)
//
// Two profiles: desktop (no throttling) and a phone (390×844, 4× CPU slowdown, DevTools
// "Slow 4G": 562.5 ms RTT, 1.44 Mbps down). Prints medians of:
//   fcp / lcp        first (largest) contentful paint, ms
//   titleVisible     the Jump button is on screen
//   usable           the Jump button is on screen AND wired (main.js finished)
//   firstFrame       the 3D canvas presented its first frame (first draw to the screen, not to a target)
//   longN/Max/Sum    main-thread long tasks (> 50 ms)
//   jsKB / totalKB   bytes over the wire (encoded), nReq requests
//   warmReq          requests that still hit the network on a warm reload (revalidations)
//   tapToRun         phone only (0053): a returning player (how-to seen) taps the Jump with a raw CDP touch the moment
//                    it is usable; ms from that tap until the run starts (body[data-mode] leaves 'title'), and
//                    engineAt (the physics WASM instantiated) / wasmEnd (its last byte), ms from navigation.
//                    The start is read by a MutationObserver: a timer poll is starved on the title while the
//                    reference ghosts fly (scheduler.yield outranks timers), which once read 37 s for ≈ 10 s.
import { chromium } from '@playwright/test';

const [url, label = 'run', runsArg = '3'] = process.argv.slice(2);
if (!url) { console.error('usage: node scripts/perf.mjs <url> [label] [runs]'); process.exit(1); }
const RUNS = Number(runsArg);
const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, cpu: 1, net: null },
  'phone 4xCPU Slow4G': {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, cpu: 4,
    net: { offline: false, latency: 562.5, downloadThroughput: (1.6e6 * 0.9) / 8, uploadThroughput: (750e3 * 0.9) / 8 },
  },
};

const INIT = `
(() => {
  window.__perf = { longtasks: [], firstDraw: 0, firstFrame: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { const e = l.getEntries(); window.__perf.lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) for (const fn of ['drawElements', 'drawArrays']) {
    const orig = C.prototype[fn];
    C.prototype[fn] = function (...a) {
      if (!window.__perf.firstDraw && this.canvas && this.canvas.id === 'stage' && this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
        window.__perf.firstDraw = performance.now();
        requestAnimationFrame(() => { window.__perf.firstFrame = performance.now(); });
      }
      return orig.apply(this, a);
    };
  }
  const poll = () => {
    const btn = document.querySelector('[data-start]');
    const vis = btn && btn.getBoundingClientRect().width > 0 && !btn.closest('[hidden]');
    if (!window.__perf.titleVisible && vis) window.__perf.titleVisible = performance.now();
    if (!window.__perf.usable && vis && window.__coldgas) window.__perf.usable = performance.now();
    if (!window.__perf.usable || !window.__perf.firstFrame) setTimeout(poll, 5);
  };
  poll();
})();`;

const TAP_INIT = `
(() => {
  try { localStorage.setItem('coldgas_howto', 'seen'); } catch {}
  window.__tap = {};
  new MutationObserver(() => {
    const m = document.body && document.body.dataset.mode;
    if (m && m !== 'title' && !window.__tap.start) window.__tap.start = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-mode'] });
  // The engine is up when its WASM's first instance is (src/sim/engine.js; later WASM, e.g. the forge's decoder, comes after).
  for (const k of ['instantiate', 'instantiateStreaming']) {
    const orig = WebAssembly[k];
    if (orig) WebAssembly[k] = function (...a) { const q = orig.apply(this, a); q.then(() => { window.__tap.engineAt ??= performance.now(); }, () => {}); return q; };
  }
})();`;

// One cold load as a returning player: tap the Jump the moment it's usable, time until the run starts.
async function tapToRun(p) {
  const ctx = await browser.newContext({ viewport: p.viewport, isMobile: p.isMobile, hasTouch: p.hasTouch, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (p.net) await cdp.send('Network.emulateNetworkConditions', p.net);
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  await page.addInitScript(TAP_INIT);
  await page.goto(url, { waitUntil: 'commit' });
  const h = await page.waitForFunction(() => {
    const b = document.querySelector('[data-start]'), r = b && b.getBoundingClientRect();
    return b && r.width > 0 && !b.closest('[hidden]') && window.__coldgas && { t: performance.now(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, null, { timeout: 180_000, polling: 20 });
  const { t, x, y } = await h.jsonValue();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__tap.start, null, { timeout: 240_000, polling: 100 });
  const m = await page.evaluate(() => ({
    start: window.__tap.start, engineAt: window.__tap.engineAt,
    wasmEnd: performance.getEntriesByType('resource').find((e) => /\.wasm/.test(e.name))?.responseEnd,
  }));
  await ctx.close();
  return { tapToRun: m.start - t, engineAt: m.engineAt, wasmEnd: m.wasmEnd };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const out = {};
for (const [name, p] of Object.entries(PROFILES)) {
  const rows = [];
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.newContext({ viewport: p.viewport, isMobile: p.isMobile, hasTouch: p.hasTouch, deviceScaleFactor: p.isMobile ? 3 : 1 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (p.net) await cdp.send('Network.emulateNetworkConditions', p.net);
    if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    const mime = new Map();
    let jsBytes = 0, totalBytes = 0, nReq = 0, counting = true, warm = 0;
    const cached = new Set();
    cdp.on('Network.responseReceived', (e) => mime.set(e.requestId, e.response.mimeType));
    cdp.on('Network.requestServedFromCache', (e) => cached.add(e.requestId));
    cdp.on('Network.loadingFinished', (e) => {
      if (counting) {
        nReq++; totalBytes += e.encodedDataLength;
        if (/javascript/.test(mime.get(e.requestId) || '')) jsBytes += e.encodedDataLength;
      } else if (!cached.has(e.requestId)) warm++;
    });
    await page.addInitScript(INIT);
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__perf?.usable && window.__perf.firstFrame, null, { timeout: 180_000, polling: 50 });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const lt = window.__perf.longtasks;
      const gl = (() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const d = c && c.getExtension('WEBGL_debug_renderer_info');
        return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?';
      })();
      return {
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, lcp: window.__perf.lcp,
        titleVisible: window.__perf.titleVisible, usable: window.__perf.usable, firstFrame: window.__perf.firstFrame,
        longN: lt.length, longMax: Math.max(0, ...lt.map((x) => x[1])), longSum: lt.reduce((s, x) => s + x[1], 0), gl,
      };
    });
    const row = { ...m, jsKB: jsBytes / 1024, totalKB: totalBytes / 1024, nReq };
    if (r === 0) {
      // Warm repeat visit: populate the cache with one cached load, then count what a reload fetches.
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      counting = false;
      await page.reload({ waitUntil: 'networkidle' });
      warm = 0;
      await page.reload({ waitUntil: 'networkidle' });
      row.warmReq = warm;
    }
    rows.push(row);
    await ctx.close();
  }
  const keys = ['fcp', 'lcp', 'titleVisible', 'usable', 'firstFrame', 'longN', 'longMax', 'longSum', 'jsKB', 'totalKB', 'nReq'];
  out[name] = Object.fromEntries(keys.map((k) => [k, Math.round(med(rows.map((x) => x[k] ?? NaN)))]));
  out[name].warmReq = rows[0].warmReq;
  out[name].gl = rows[0].gl;
  if (p.isMobile) {
    const taps = [];
    // A tap that misses (the title still settling under the touch) is one lost sample, not the whole report.
    for (let r = 0; r < RUNS; r++) taps.push(await tapToRun(p).catch((err) => { console.error('tapToRun run failed:', err.message.split('\n')[0]); return {}; }));
    for (const k of ['tapToRun', 'engineAt', 'wasmEnd']) out[name][k] = Math.round(med(taps.map((x) => x[k] ?? NaN)));
    console.error(name, 'runs [tapToRun, engineAt, wasmEnd]:', JSON.stringify(taps.map((x) => [x.tapToRun, x.engineAt, x.wasmEnd].map(Math.round))));
  }
  console.error(name, 'runs [fcp, usable, firstFrame]:', JSON.stringify(rows.map((x) => [x.fcp, x.usable, x.firstFrame].map(Math.round))));
}
await browser.close();
console.log(label, JSON.stringify(out, null, 1));
