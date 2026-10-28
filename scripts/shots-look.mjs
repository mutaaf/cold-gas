// The same moments on a desktop, a phone and an iPad, each a fresh device (no ledger), each at the
// tier it boots (0097: one look everywhere). With two URLs (before, after) it also writes one
// side-by-side sheet per moment: a row per build, the three devices across.
//   node scripts/shots-look.mjs <outdir> <url> [<url-before>] [--moments=title,release,landing,results,road]
// The GPU (Metal ANGLE), like shots.mjs: software GL is too slow to fly the reference run in real time.
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const [out = 'docs/shots/look', after = 'http://localhost:4320/coldgas/', before] = pos;
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const MOMENTS = opt('moments', 'title,release,landing,results,road').split(',');
mkdirSync(out, { recursive: true });

const strip = ({ defaultBrowserType: _, ...d }) => d;
const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { ...strip(devices['iPhone 13']), viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  ipad: { ...strip(devices['iPad Pro 11']), viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 },
};
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const builds = before ? [['before', before], ['after', after]] : [['after', after]];
const info = {};

async function shoot(page, file) {
  // CSS pixels: every device's frame at the same scale for the sheet (the drawing buffer's own resolution is in info.json).
  await page.screenshot({ path: file, type: 'jpeg', quality: 86, scale: 'css' });
}
const wait = async (page, pred, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(pred).catch(() => false)) return true; await page.waitForTimeout(40); }
  return false;
};

for (const [b, url] of builds) {
  for (const [dev, ctxOpts] of Object.entries(PROFILES)) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 120000 });
    await page.evaluate(() => Promise.all([window.__coldgas.stage.ready, window.__coldgas.stage.backdrop]));
    await page.waitForTimeout(3000);   // the film look fades in over a second (0046)
    info[`${b}-${dev}`] = await page.evaluate(() => {
      const G = window.__coldgas, st = G.stage, c = st.renderer.domElement;
      return { tier: G.obs.tier, pixelRatio: st.renderer.getPixelRatio(), buffer: `${c.width}x${c.height}`, shadow: st.key.shadow.mapSize.x, film: !!st.film?.haze };
    });
    if (MOMENTS.includes('title')) await shoot(page, `${out}/${b}-${dev}-title.jpg`);
    if (MOMENTS.some((m) => ['release', 'landing', 'results'].includes(m))) {
      await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60000, polling: 100 });
      await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
      await wait(page, () => window.__coldgas.S.run?.phase === 'air');
      await page.waitForTimeout(300);
      if (MOMENTS.includes('release')) await shoot(page, `${out}/${b}-${dev}-release.jpg`);
      await wait(page, () => window.__coldgas.S.run?.phase === 'landed');
      await page.waitForTimeout(150);
      if (MOMENTS.includes('landing')) await shoot(page, `${out}/${b}-${dev}-landing.jpg`);
      await wait(page, () => window.__coldgas.S.mode === 'results');
      await page.waitForTimeout(3500);
      if (MOMENTS.includes('results')) await shoot(page, `${out}/${b}-${dev}-results.jpg`);
    }
    if (MOMENTS.includes('road')) {
      await page.evaluate(() => window.__coldgas.toTitle?.());
      await page.evaluate(() => window.__coldgas.loadDrive().then((d) => d.start('stelvio', { tod: 'day' })));
      await page.waitForFunction(() => window.__coldgas.drive?.active, null, { timeout: 90000 });
      await page.evaluate(() => { const d = window.__coldgas.drive; d.goto(d.road.length * 0.55, 1); d.autopilot(true, { vmax: 26 }); d.cam.mode = 'chase'; });
      await page.waitForTimeout(6000);
      await shoot(page, `${out}/${b}-${dev}-road.jpg`);
    }
    if (errors.length) info[`${b}-${dev}`].errors = errors.slice(0, 5);
    console.log(b, dev, JSON.stringify(info[`${b}-${dev}`]));
    await ctx.close();
  }
}

// The side-by-side sheets: one per moment, a row per build, desktop · phone · iPad at one height.
if (before) {
  const H = 560;
  const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } });
  for (const m of MOMENTS) {
    const img = (b, dev) => `data:image/jpeg;base64,${readFileSync(`${out}/${b}-${dev}-${m}.jpg`).toString('base64')}`;
    const cell = (b, dev) => {
      const i = info[`${b}-${dev}`];
      return `<figure><img src="${img(b, dev)}" style="height:${H}px"><figcaption>${dev} · ${i.tier} · ×${i.pixelRatio}<br>shadow ${i.shadow} · film ${i.film ? 'on' : 'off'}</figcaption></figure>`;
    };
    const row = (b) => `<section><h2>${b === 'before' ? 'Before (main)' : 'After (0097)'}</h2><div>${Object.keys(PROFILES).map((d) => cell(b, d)).join('')}</div></section>`;
    await page.setContent(`<style>body{margin:0;padding:16px;background:#0b0c0e;color:#c9ccd1;font:13px/1.3 ui-monospace,Menlo,monospace}
      h1{font-size:15px;margin:0 0 10px;color:#fff}h2{font-size:13px;margin:10px 0 6px;color:#fff}section div{display:flex;gap:10px;align-items:flex-start}
      figure{margin:0}figcaption{margin-top:4px;width:0;min-width:100%;font-size:12px}img{display:block;border:1px solid #2a2d33}</style>
      <h1>${m} · 1440×900 desktop · 390×844 phone · 820×1180 iPad (CSS pixels)</h1>${row('before')}${row('after')}`);
    await page.waitForTimeout(200);
    const dims = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
    await page.setViewportSize({ width: dims.w, height: dims.h });
    await page.screenshot({ path: `${out}/${m}.jpg`, type: 'jpeg', quality: 84, fullPage: true });
  }
}
(await import('node:fs')).writeFileSync(`${out}/info.json`, JSON.stringify(info, null, 2));
await browser.close();
