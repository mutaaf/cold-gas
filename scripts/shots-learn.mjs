// Screenshots of the skill ladder: the landing HUD, the drills, the coach, Advanced's nozzle pad.
//   node scripts/shots-learn.mjs <outdir> [url] [desktop|phone]
import { chromium } from '@playwright/test';

const [out, url = 'http://localhost:4391/coldgas/', form = 'desktop'] = process.argv.slice(2);
const phone = form === 'phone';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/api\/|404/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => { await page.screenshot({ path: `${out}/${form}-${name}.png` }); console.log('shot', name); };
const until = (fn, timeout = 30000) => page.waitForFunction(fn, null, { timeout }).catch(() => console.log('missed', fn.toString().slice(0, 80)));
const G = (fn) => page.evaluate(fn);

await page.goto(url);
await until(() => window.__coldgas?.stage);
await page.waitForTimeout(2500);
await shot('0-title');
if (phone) await page.locator('[data-practice-open]').tap(); else await page.locator('[data-practice-open]').click();
await page.waitForTimeout(700);
await shot('1-drills');

// Assist, drill 02: let go, then hold BOOST + LAND (keyboard), as the cue says.
await G(() => { window.__coldgas.setTier('assist'); window.__coldgas.startDrill('release'); });
await page.waitForTimeout(300);
await shot('2-drill-freeze');
await until(() => window.__coldgas.S.freezeT <= 0);
if (!phone) { await page.keyboard.down('KeyF'); await page.keyboard.down('ShiftLeft'); }
else {
  await until(() => document.querySelector('[data-touch]').dataset.phase === 'air', 8000);
  const cdp = await page.context().newCDPSession(page);
  const c = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const go = await c('[data-btn-go]'), land = await c('[data-btn-land]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...go, id: 1 }, { ...land, id: 2 }] });
  page.cdp = cdp;
}
await until(() => { const r = window.__coldgas.S.run; return r.phase === 'air' && r.car.pos.y < 22; });
await shot('3-hud-rollout');
await until(() => { const r = window.__coldgas.S.run; return r.phase === 'air' && r.car.pos.y < 9; });
await shot('4-hud-brake');
await until(() => window.__coldgas.S.mode === 'results', 40000);
if (!phone) { await page.keyboard.up('KeyF'); await page.keyboard.up('ShiftLeft'); }
else await page.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(1500);
await shot('5-drill-result');

// Pro, drill 04 (10 m up, falling fast), hands off: the band goes red.
await G(() => { window.__coldgas.setTier('pro'); window.__coldgas.startDrill('land'); });
await until(() => window.__coldgas.S.freezeT <= 0);
await page.waitForTimeout(250);
await shot('6-hud-red');
await until(() => window.__coldgas.S.mode === 'results', 30000);
await page.waitForTimeout(1500);
await shot('7-coach');

// Advanced, drill 02: the nozzle diagram with keys (desktop) or the nozzle pad (phone).
await G(() => { window.__coldgas.setTier('advanced'); window.__coldgas.startDrill('release'); });
await until(() => window.__coldgas.S.freezeT <= 0);
if (!phone) {
  await page.keyboard.down('KeyF'); await page.waitForTimeout(250); await page.keyboard.up('KeyF');
  await page.keyboard.down('KeyA'); await page.keyboard.down('KeyQ');
  await page.waitForTimeout(220);
  await shot('8-advanced-valves');
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyQ');
} else {
  await until(() => !document.querySelector('[data-nozzle-pad]').hidden, 8000);
  const pad = await page.locator('[data-nozzle-pad] svg').boundingBox();
  const at = (x, y) => ({ x: pad.x + (x / 300) * pad.width, y: pad.y + (y / 380) * pad.height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at(58, 116), id: 1 }, { ...at(150, 342), id: 2 }] });
  await page.waitForTimeout(260);
  await shot('8-advanced-pad');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
await G(() => window.__coldgas.setTier('assist'));
console.log('errors:', errors.slice(0, 6).join(' | ') || 'none');
await browser.close();
