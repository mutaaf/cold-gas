// Free Drive frame-time probe: a phone profile (390×844, DPR 3, touch, CPU throttled 4×) or
// desktop, the autopilot driving each road for a while; reports frame-time percentiles and the
// world's draw calls and triangles.
//   node scripts/perf-drive.mjs [url] [phone|desktop] [roads] [seconds] [gfx]
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4320/coldgas/', profile = 'phone', roadsArg = 'stelvio,transfagarasan,bigsur,atlantic', secs = '20', gfx] = process.argv.slice(2);
const phone = profile === 'phone';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (phone) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}
const q = gfx ? `?gfx=${gfx}` : '';
for (const id of roadsArg.split(',')) {
  const t0 = Date.now();
  await page.goto(`${url}${q}${q ? '&' : '?'}drive=${id}`);
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120000 });
  const loadS = (Date.now() - t0) / 1000;
  await page.evaluate(() => { const d = window.__coldgas.drive; d.goto(d.road.length * 0.3, 1); d.autopilot(true, { vmax: 30 }); });
  await page.waitForTimeout(2500);
  const res = await page.evaluate((secs) => new Promise((resolve) => {
    const dts = []; let last = performance.now(); const end = last + secs * 1000;
    const tick = (now) => { dts.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(dts); };
    requestAnimationFrame(tick);
  }), Number(secs));
  const s = res.slice().sort((a, b) => a - b), pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const st = await page.evaluate(() => window.__coldgas.drive.stats());
  console.log(`${id} [${profile}${gfx ? ` gfx=${gfx}` : ''}] load ${loadS.toFixed(1)}s · ${(1000 / (res.reduce((a, b) => a + b, 0) / res.length)).toFixed(1)} fps avg · p50 ${pct(0.5).toFixed(1)} ms · p95 ${pct(0.95).toFixed(1)} ms · p99 ${pct(0.99).toFixed(1)} ms · draws ${st.draws} · tris ${(st.tris / 1000).toFixed(0)}k · tiles ${st.tiles0}/${st.tiles1} · chunks ${st.chunks} · ${(st.speed * 3.6).toFixed(0)} km/h`);
}
console.log('errors:', errors.slice(0, 5).join(' | ') || 'none');
await browser.close();
