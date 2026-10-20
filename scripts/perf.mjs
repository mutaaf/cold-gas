// First-load performance probe (cold cache), the numbers behind "time to first paint".
//
//   node scripts/perf.mjs <url> [label] [runs]
//   node scripts/perf.mjs http://localhost:4173/coldgas/ local 3      (after build + preview)
//   node scripts/perf.mjs https://mutaafaziz.com/coldgas/ prod 3
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

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
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
  console.error(name, 'runs [fcp, usable, firstFrame]:', JSON.stringify(rows.map((x) => [x.fcp, x.usable, x.firstFrame].map(Math.round))));
}
await browser.close();
console.log(label, JSON.stringify(out, null, 1));
