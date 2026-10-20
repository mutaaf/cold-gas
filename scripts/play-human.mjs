// Play the Show the way a person does: read only what's on screen (the cue line and the HUD
// numbers), press real keys (or tap the touch controls), with a person's reaction time. Nothing
// here reads the sim. Run it against production and against a local build to compare.
//
//   node scripts/play-human.mjs <url> [keyboard|touch] [runs=3] [outdir]
//
// The player: crawl in at about 20 km/h, feather up the curl, let go when the cue says, then do
// what the cues say (BOOST, roll, LAND) for as long as they say it, a reaction time late.
import { chromium } from '@playwright/test';

const [url = 'http://localhost:4391/coldgas/', mode = 'keyboard', runsArg = '3', out] = process.argv.slice(2);
const RUNS = Number(runsArg);
const touch = mode === 'touch';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(touch ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}${url.includes('?') ? '&' : '?'}gfx=low`);
await page.waitForFunction(() => !!window.__coldgas, null, { timeout: 30000 });
await page.waitForTimeout(1500);

const REACT = 260;   // ms
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const held = new Set();
// Touch: hold a control with a real pointer (CDP touch events), one finger per control.
const cdp = touch ? await page.context().newCDPSession(page) : null;
const fingers = new Map();
async function centre(sel) {
  const b = await page.locator(sel).boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}
async function syncTouches() {
  const pts = [];
  for (const [, p] of fingers) pts.push({ x: p.x, y: p.y, id: p.id });
  await cdp.send('Input.dispatchTouchEvent', { type: pts.length ? 'touchMove' : 'touchEnd', touchPoints: pts });
}
async function press(key, on) {
  if (on === held.has(key)) return;
  if (on) held.add(key); else held.delete(key);
  if (!touch) { if (on) await page.keyboard.down(key); else await page.keyboard.up(key); return; }
  const sel = { ArrowUp: '[data-btn-go]', F: '[data-btn-go]', Space: '[data-btn-lift]', Shift: '[data-btn-land]', ArrowLeft: '[data-stick]' }[key];
  if (!sel) return;
  if (on) {
    const c = await centre(sel);
    if (!c) return;
    if (key === 'ArrowLeft') c.x -= 50;
    fingers.set(key, { ...c, id: fingers.size + 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...fingers.values()].map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  } else {
    fingers.delete(key);
    await syncTouches();
  }
}
// The cue line as a person reads it: its words and the keys (or buttons) it names.
const read = () => page.evaluate(() => ({
  cue: document.querySelector('[data-cue]')?.classList.contains('on') ? document.querySelector('[data-cue]').textContent : '',
  keys: document.querySelector('[data-cue]')?.classList.contains('on') ? [...document.querySelectorAll('[data-cue] kbd')].map((k) => k.textContent.trim().toLowerCase()) : [],
  speed: Number(document.querySelector('[data-speed]')?.textContent || 0),
  mode: window.__coldgas.S.mode,
  hasTier: !!document.querySelector('[data-tier]'),
}));

const results = [];
for (let r = 0; r < RUNS; r++) {
  if (touch) await page.locator('[data-start]').tap(); else await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30000 });
  let released = false, landing = false, boostOff = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const s = await read();
    if (s.mode !== 'live') break;
    const cue = s.cue.toLowerCase();
    if (!released) {
      // Crawl in at about 20 km/h, feather up the curl (a person taps the key).
      if (/let go/.test(cue)) {
        await press('ArrowUp', false); await sleep(REACT);
        await press('Space', true); await sleep(180); await press('Space', false);
        released = true;
        continue;
      }
      await press('ArrowUp', s.speed < 17);
    } else {
      // Then do what the cue says, for as long as it says it (a reaction time late).
      const says = (k) => s.keys.includes(k);
      const boost = /boost/.test(cue) || says('f');
      if (boost) { boostOff = 0; await press('F', true); }
      else if (held.has('F')) { boostOff ||= Date.now(); if (Date.now() - boostOff > REACT) await press('F', false); }
      if (/roll upright|roll out/.test(cue) && (says('← →') || says('stick'))) { await press('ArrowLeft', true); }
      else if (held.has('ArrowLeft')) { await sleep(REACT); await press('ArrowLeft', false); }
      if ((/land/.test(cue) || says('shift')) && !landing) { await sleep(REACT); landing = true; }
      await press('Shift', landing);
    }
    await sleep(40);
  }
  for (const k of [...held]) await press(k, false);
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60000 }).catch(() => {});
  const card = await page.evaluate(() => { const c = window.__coldgas.S.card; return c && { total: c.total, verdict: c.verdict, landed: !!c.facts.jumped, sink: c.facts.sink, padMiss: c.facts.padMiss, crossed: c.facts.crossedRow, tier: c.tier || (window.__coldgas.S.assist ? 'assist' : 'pro') }; });
  results.push(card);
  console.log(`run ${r + 1}:`, JSON.stringify(card));
  if (out) { await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/human-${mode}-${r + 1}.png` }); }
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.waitForTimeout(800);
}
const clean = results.filter((c) => c && c.landed && !/crash|rolled|contact|fell|deck|short|no /i.test(c.verdict) && c.sink <= 3).length;
console.log(`${mode}: ${clean}/${RUNS} landed clean`);
console.log('errors:', errors.slice(0, 5).join(' | ') || 'none');
await browser.close();
