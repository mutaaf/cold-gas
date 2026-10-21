// Screenshots of the endless road: each biome along a seed, day and dusk, chase and cinema, with
// the autopilot driving; prints the world's stats and any console errors.
//   node scripts/shots-endless.mjs <outdir> [url] [desktop|phone|land] [seed] [tods=day,dusk] [gfx]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out = 'docs/shots/endless', url = 'http://localhost:4320/coldgas/', profile = 'desktop', seed = 'cold-gas', todsArg = 'day,dusk', gfx] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = profile === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : profile === 'land' ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
const page = await browser.newPage(ctx);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
const tag = profile === 'desktop' ? '' : `-${profile}`;
for (const tod of todsArg.split(',')) {
  await page.goto(`${url}?drive=endless&seed=${encodeURIComponent(seed)}&tod=${tod}${gfx ? `&gfx=${gfx}` : ''}`);
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120000 });
  // Where each biome first holds the road for a while.
  const spots = await page.evaluate(() => {
    const d = window.__coldgas.drive, r = d.road;
    r.generate(16000);
    // The middle of each biome's longest stretch of road.
    const best = {}, names = ['mountain', 'coast', 'desert', 'forest'];
    let a = 40;
    for (let i = 41; i < r.n - 400; i++) {
      if (r.biome[i] === r.biome[a] && i < r.n - 401) continue;
      const b = names[r.biome[a]], len = i - a;
      if (!best[b] || len > best[b][1]) best[b] = [a, len];
      a = i;
    }
    return Object.fromEntries(Object.entries(best).map(([b, [s, len]]) => [b, (s + len / 2) * 3]));
  });
  console.log(tod, 'biomes at', JSON.stringify(spots));
  for (const [biome, s] of Object.entries(spots)) {
    await page.evaluate((s) => { const d = window.__coldgas.drive; d.goto(s, 1); d.autopilot(true, { vmax: 26 }); d.cam.mode = 'chase'; }, s);
    await page.waitForFunction(() => { const st = window.__coldgas.drive.stats(); return st.queue === 0 || st.ready === 0; }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/${biome}-${tod}-chase${tag}.png` });
    await page.evaluate(() => { window.__coldgas.drive.cam.mode = 'cinema'; });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${out}/${biome}-${tod}-cinema${tag}.png` });
    console.log(biome, tod, JSON.stringify(await page.evaluate(() => { const s = window.__coldgas.drive.stats(); return { fps: s.fps, tiles: s.tiles, chunks: s.chunks, draws: s.draws, tris: s.tris, gpuMB: s.gpuMB, main: s.main, worker: s.worker }; })));
  }
}
console.log('errors:', errors.slice(0, 10).join(' | ') || 'none');
await browser.close();
