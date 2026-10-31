// The title at the sizes players hold it (phone upright and sideways, a 360 px phone, an iPad, a laptop):
// one screenshot each, for before/after comparisons of the title's hierarchy.
//   node scripts/shots-title.mjs <url> <outdir> <label> [--only=WxH,...] [--pb]
// --pb flies one run first (the reference, handed over as it ends so it counts as the player's) and goes
// Home, so the title shows a personal best for the event.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'docs/shots/audit-title', label = 'title'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const pb = process.argv.includes('--pb');
mkdirSync(out, { recursive: true });
const VPS = [[390, 844, 1], [844, 390, 1], [360, 780, 1], [820, 1180, 1], [1280, 720, 0]];
const GL = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });
for (const [w, h, touch] of VPS) {
  if (only && !only.includes(`${w}x${h}`)) continue;
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60000 });
  if (pb) {
    await page.evaluate(() => {
      const g = window.__coldgas, S = g.S;
      g.startRun('jump', true);
      S.autopilot = g.createAutopilot(g.stage.course);
      g.skipCountdown();
      for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
      S.autopilot = null;
      for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
      g.toTitle();
    });
  }
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/${label}-${w}x${h}.png` });
  console.log(`${label}-${w}x${h}.png`);
  await page.close();
}
await browser.close();
