// Screenshots of the Show reference run at each moment. node scripts/shots-show.mjs outdir [url] [phone]
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
await page.evaluate(() => window.__coldgas.startRun('reveal'));
await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 20000 });
const shots = [
  ['1-approach', (S) => S.run.car.pos.z > -70],
  ['2-climb', (S) => S.run.phase === 'ramp' && S.run.car.pos.y > 8],
  ['3-inverted', (S) => S.run.phase === 'ramp' && S.run.t.invertedTime > 0.2],
  ['4-rollout', (S) => S.run.phase === 'air' && S.run.car.pos.y < 14],
  ['5-service', (S) => S.run.phase === 'service'],
  ['6-lane', (S) => S.run.leg === 1 && S.run.car.pos.x < -8],
  ['7-kickflip', (S) => S.run.leg === 1 && S.run.phase === 'air' && Math.abs(S.run.t.rollAccum) > 2.6],
  ['8-landing', (S) => S.run.leg === 1 && (S.run.phase === 'landed' || (S.run.phase === 'air' && S.run.car.pos.y < 1.6 && Math.abs(S.run.t.rollAccum) > 6))],
];
for (const [name, pred] of shots) {
  const fn = `(${pred.toString()})(window.__coldgas.S)`;
  await page.waitForFunction(fn, null, { timeout: 60000 }).catch(() => console.log('missed', name));
  await page.screenshot({ path: `${out}/${name}.png` });
}
await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/9-results.png` });
console.log(JSON.stringify(await page.evaluate(() => ({ total: window.__coldgas.S.card?.total, verdict: window.__coldgas.S.card?.verdict }))));
console.log('errors:', errors.filter((e) => !/api\//.test(e) && !/404/.test(e)).slice(0, 6).join(' | '));
await browser.close();
