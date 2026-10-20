// Screenshots of the Wall reference run at each moment. node scripts/shots-wall.mjs outdir [url] [phone]
import { chromium } from '@playwright/test';
const [out, url = 'http://localhost:4320/coldgas/', phone] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/0-title.png` });
await page.evaluate(() => window.__coldgas.startRun(new URL(location.href).searchParams.get('kind') || 'reveal'));
await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 20000 });
const shots = [
  ['1-approach', (S) => S.run.car.pos.z > -30],
  ['2-climb', (S) => S.run.phase === 'ramp' && S.run.car.pos.y > 8],
  ['3-inverted', (S) => S.run.phase === 'ramp' && S.run.t.invertedTime > 0.2],
  ['4-release', (S) => S.run.phase === 'air'],
  ['5-rollout', (S) => S.run.phase === 'air' && S.run.car.pos.y < 18],
  ['6-landing', (S) => S.run.phase === 'landed' || (S.run.phase === 'air' && S.run.car.pos.y < 2.2)],
];
for (const [name, pred] of shots) {
  const fn = `(${pred.toString()})(window.__coldgas.S)`;
  await page.waitForFunction(fn, null, { timeout: 40000 }).catch(() => console.log('missed', name));
  await page.screenshot({ path: `${out}/${name}.png` });
}
await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/7-results.png` });
console.log(JSON.stringify(await page.evaluate(() => ({ total: window.__coldgas.S.card?.total, verdict: window.__coldgas.S.card?.verdict }))));
console.log('errors:', errors.filter((e) => !/api\//.test(e) && !/404/.test(e)).slice(0, 6).join(' | '));
await browser.close();
