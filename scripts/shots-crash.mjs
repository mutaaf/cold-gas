// Screenshots of crash moments, keyed to the run's own impact events.
//   node scripts/shots-crash.mjs outdir [url] [phone] [only]
// Cases: the Show dropped onto the row (no carry), a Lineup roll that lands on its roof
// (rollover), full throttle up the curl (thrown off the ledge), a Lineup jump too low to clear.
import { chromium } from '@playwright/test';
const [out, url = 'http://localhost:4320/coldgas/', phone, only] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone === 'phone' ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);

const CASES = [
  { id: 'row', course: 'show', pilot: { carry: 5 } },
  { id: 'rollover', course: 'lineup', pilot: { rolls: 0.5 } },
  { id: 'thrown', course: 'show', pilot: 'full' },
  { id: 'low', course: 'lineup', pilot: { apex: 2.5 } },
];
// After the first big hit: the moment, the slow-motion beat, the tumble, the aftermath.
const AFTER = [[2, 'a-impact'], [14, 'b-beat'], [70, 'c-tumble'], [260, 'd-after']];

for (const c of CASES) {
  if (only && only !== c.id) continue;
  await page.evaluate(({ course, pilot }) => {
    const g = window.__coldgas;
    g.stage.setCourse(course);
    g.startRun('reveal');
    g.S.autopilot = pilot === 'full' ? () => ({ throttle: 1, fan: 1, assist: 1 }) : g.createAutopilot(course, pilot);
    g.skipCountdown();
  }, c);
  const big = await page.waitForFunction(() => {
    const imp = window.__coldgas.S.run?.impacts;
    if (!imp) return false;
    for (let i = 0; i < imp.count; i++) if ((imp.kind[i] === 0 && imp.speed[i] > 6) || (imp.kind[i] === 2 && imp.speed[i] > 5)) return imp.tick[i];
    return window.__coldgas.S.mode !== 'live' ? -1 : false;
  }, null, { timeout: 90000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => -1);
  console.log(c.id, 'first big hit at tick', big);
  if (big < 0) continue;
  for (const [dt, name] of AFTER) {
    const ok = await page.waitForFunction((t) => window.__coldgas.S.run.tick >= t || window.__coldgas.S.mode !== 'live', big + dt, { timeout: 60000, polling: 'raf' }).catch(() => null);
    if (!ok) { console.log('missed', c.id, name); continue; }
    await page.screenshot({ path: `${out}/crash-${c.id}-${name}.png` });
  }
  // The replay re-shows it: wait for the results, then for the replay to reach the hit.
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('[data-screen="results"]')?.setAttribute('hidden', ''));
  const ok = await page.waitForFunction((t) => (window.__coldgas.S.replayT + 1) * 4 >= t + 30, big, { timeout: 90000, polling: 'raf' }).catch(() => null);
  if (ok) await page.screenshot({ path: `${out}/crash-${c.id}-e-replay.png` });
  const st = await page.evaluate(() => ({ total: window.__coldgas.S.card?.total, verdict: window.__coldgas.S.card?.verdict, count: window.__coldgas.S.run.impacts.count }));
  console.log(c.id, JSON.stringify(st));
}
console.log('errors:', errors.filter((e) => !/api\//.test(e) && !/404/.test(e)).slice(0, 6).join(' | '));
await browser.close();
