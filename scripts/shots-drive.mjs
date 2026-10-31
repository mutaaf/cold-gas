// Free Drive screenshots: the picker, then each road at a few points along it, day and dusk,
// chase and cinema cameras, with the autopilot driving.
//   node scripts/shots-drive.mjs outdir [url] [phone] [roads=stelvio,transfagarasan,bigsur,atlantic] [tods=day,dusk]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out = 'docs/shots/drive', url = 'http://localhost:4320/coldgas/', phone, roadsArg, todsArg] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const roads = (roadsArg || 'stelvio,transfagarasan,bigsur,atlantic').split(',');
const tods = (todsArg || 'day,dusk').split(',');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = phone === 'phone'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : phone === 'land' ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
const page = await browser.newPage(ctx);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const tag = phone ? `-${phone}` : '';
await page.goto(url);
await page.waitForTimeout(2000);
await page.evaluate(() => { document.querySelector('[data-play-more]').open = true; });   // More ways to play (the title's disclosure)
await page.click('[data-drive-open]');
await page.waitForSelector('.fd-card');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/picker${tag}.png` });
// Where to stand on each road (fractions of its length).
const spots = { stelvio: [0.06, 0.55, 0.93], transfagarasan: [0.55, 0.8, 0.95], bigsur: [0.12, 0.42, 0.7], atlantic: [0.2, 0.45, 0.62] };
for (const id of roads) {
  for (const tod of tods) {
    await page.evaluate(([id, tod]) => window.__coldgas.loadDrive().then((d) => d.start(id, { tod })), [id, tod]);
    await page.waitForFunction(() => window.__coldgas.drive?.active, null, { timeout: 60000 });
    for (const [k, f] of (spots[id] || [0.3]).entries()) {
      await page.evaluate((f) => { const d = window.__coldgas.drive; d.goto(d.road.length * f, 1); d.autopilot(true, { vmax: 26 }); d.cam.mode = 'chase'; }, f);
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `${out}/${id}-${tod}-${k}-chase${tag}.png` });
      if (k === 1) {
        await page.evaluate(() => { window.__coldgas.drive.cam.mode = 'cinema'; });
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${out}/${id}-${tod}-${k}-cinema${tag}.png` });
      }
    }
    console.log(id, tod, JSON.stringify(await page.evaluate(() => window.__coldgas.drive.stats())));
    await page.evaluate(() => window.__coldgas.drive.exit());
  }
}
console.log('errors:', errors.slice(0, 8).join(' | ') || 'none');
await browser.close();
