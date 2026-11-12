#!/usr/bin/env node
// The forge's in-game review shots (0211): the same moments with the procedural row and with the forged one, on a
// phone (390×844, touch, DPR 3) and a laptop (1280×720): the Show's title, the reference jump passing the row, the
// Lineup's title. Against a running server (npm run dev, or a preview of dist):
//   node tools/forge/shots.mjs [outdir] [url]      (default tools/forge/out/shots, http://localhost:4330/coldgas/)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [out = 'tools/forge/out/shots', base = 'http://localhost:4330/coldgas/'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const sizes = [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]];
for (const [label, ctxOpts] of sizes) {
  for (const forge of [0, 1]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/api\/|404/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}?forge=${forge}`);
    await page.waitForFunction(() => window.__coldgas?.S.mode === 'title', null, { timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('coldgas_howto', 'seen'));
    if (forge) await page.waitForFunction(() => window.__coldgas.stage.useForged() > 0 || [...(function* f(o) { yield o; for (const c of o.children) yield* f(c); })(window.__coldgas.stage.scene)].some((o) => o.userData?.forged), null, { timeout: 60000, polling: 500 });
    await page.waitForTimeout(1500);
    const tag = `${label}-${forge ? 'forged' : 'procedural'}`;
    await page.screenshot({ path: `${out}/${tag}-show-title.png` });
    // the reference jump: the chase past the row, the release over it
    await page.locator('[data-reveal]').click();
    for (const [t, name] of [[3200, 'runup'], [5200, 'over'], [6600, 'carry']]) {
      await page.waitForTimeout(name === 'runup' ? t : t - (name === 'over' ? 3200 : 5200));
      await page.screenshot({ path: `${out}/${tag}-show-${name}.png` });
    }
    console.log(`forge shots: ${tag}: ${errors.length ? errors.slice(0, 3).join(' | ') : 'no errors'}`);
    await ctx.close();
  }
}
await browser.close();
