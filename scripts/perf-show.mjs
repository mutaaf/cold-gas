// Stage frame-time probe: the title and the reference run on each course, on a phone profile
// (390×844, DPR 3, touch, CPU throttled 4×, so tier 'mid') or desktop (1440×900, tier 'high').
// Reports average fps and frame-time percentiles per scene, and the frame's draw calls.
//   node scripts/perf-show.mjs [url] [phone|desktop] [courses] [seconds] [gfx]
//   node scripts/perf-show.mjs http://localhost:4320/coldgas/ phone show,lineup 8
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4320/coldgas/', profile = 'phone', coursesArg = 'show,lineup', secs = '8', gfx] = process.argv.slice(2);
const phone = profile === 'phone';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/|404/.test(m.text())) errors.push(m.text()); });
if (phone) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}
const sample = (s) => page.evaluate((secs) => new Promise((resolve) => {
  const dts = []; let last = performance.now(); const end = last + secs * 1000;
  const st = window.__coldgas.stage, r = st.renderer; let calls = 0, n = 0, cpu = []; r.info.autoReset = false; r.info.reset();
  // CPU time of the stage's render call (scene update, culling, draw submission): the headroom
  // under the 60 Hz vsync cap that the frame times alone can't show.
  const orig = st.render; st.render = (...a) => { const t0 = performance.now(); orig(...a); cpu.push(performance.now() - t0); };
  const tick = (now) => { dts.push(now - last); last = now; calls += r.info.render.calls; r.info.reset(); n++; if (now < end) requestAnimationFrame(tick); else { r.info.autoReset = true; st.render = orig; resolve({ dts, calls: calls / n, cpu }); } };
  requestAnimationFrame(tick);
}), s);
const fmt = (name, { dts, calls, cpu }) => {
  const c = cpu.slice(2).sort((a, b) => a - b), cp = (p) => c[Math.min(c.length - 1, Math.floor(p * c.length))];
  const s = dts.slice(2).sort((a, b) => a - b), pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return `${name.padEnd(16)} ${(1000 / avg).toFixed(1).padStart(5)} fps avg · p50 ${pct(0.5).toFixed(1)} ms · p95 ${pct(0.95).toFixed(1)} ms · p99 ${pct(0.99).toFixed(1)} ms · render cpu p50 ${cp(0.5).toFixed(1)} / p95 ${cp(0.95).toFixed(1)} ms · draws/frame ${calls.toFixed(0)}`;
};
const q = gfx ? `?gfx=${gfx}` : '';
for (const course of coursesArg.split(',')) {
  await page.goto(`${url}${q}${q ? '&' : '?'}course=${course}`);
  await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__coldgas.stage.ready);
  await page.waitForTimeout(4000);   // anything streamed in after first paint lands first
  console.log(fmt(`${course} title`, await sample(Number(secs))));
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  console.log(fmt(`${course} run`, await sample(Number(secs))));
}
console.log(`[${profile}${gfx ? ` gfx=${gfx}` : ''}] errors:`, errors.slice(0, 5).join(' | ') || 'none');
await browser.close();
