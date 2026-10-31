// Play the Show the way a person does: read only what's on screen (the cue line and the HUD
// numbers), press real keys (or tap the touch controls), with a person's reaction time. Nothing
// here reads the sim. Run it against production and against a local build to compare.
//
//   node scripts/play-human.mjs <url> [keyboard|touch|thumb] [runs=3] [outdir] [viewport=390x844] [--skill=careless|careful|sloppy]
//
// --skill (thumb, 0120): what the thumb does with the pad's sight in the air (src/thumb-aim.js).
//   careless  never slides (the default; the only one-thumb player before 0120)
//   careful   slides onto the amber dot, a reaction late, re-reading it every 0.3 s
//   sloppy    slides 2.5× too far, the first second the wrong way up, with a shaky thumb
//
// touch: the classic stick and pedals (the scheme is set to classic first). thumb: the one-thumb
// Assist pad, read from its own words (Hold · Climb, Tap · Let go, Hold · Land), one finger.
//
// The player: crawl in at about 20 km/h, feather up the curl, let go when the cue says, then do
// what the cues say (BOOST, roll, LAND) for as long as they say it, a reaction time late.
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const skill = (argv.find((a) => a.startsWith('--skill=')) || '--skill=careless').split('=')[1];
const [url = 'http://localhost:4391/coldgas/', mode = 'keyboard', runsArg = '3', out, vpArg = '390x844'] = argv.filter((a) => !a.startsWith('--'));
const [VW, VH] = vpArg.split('x').map(Number);
const RUNS = Number(runsArg);
const thumbMode = mode === 'thumb';
const touch = mode === 'touch' || thumbMode;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(touch ? { viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}${url.includes('?') ? '&' : '?'}gfx=low`);
await page.waitForFunction(() => !!window.__coldgas, null, { timeout: 30000 });
await page.waitForTimeout(1500);
// (Builds before the one-thumb scheme have no touch settings: classic is all there is.)
await page.evaluate((s) => window.__coldgas.touch?.set('scheme', s), thumbMode ? 'thumb' : 'classic');

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
// Lifting one finger: a touchEnd listing just that finger (CDP releases the points it lists; a
// touchMove that leaves a finger out doesn't lift it).
async function lift(p) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: p.id }] });
}
let nextId = 1;
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
    const f = { ...c, id: nextId++ };
    fingers.set(key, f);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f.x, y: f.y, id: f.id }] });
  } else {
    const f = fingers.get(key);
    fingers.delete(key);
    if (f) await lift(f);
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
let slidMax = 0, aimReads = 0;
for (let r = 0; r < RUNS; r++) {
  if (touch) await page.locator('[data-start]').tap(); else await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30000 });
  let released = false, landing = false, boostOff = 0;
  const t0 = Date.now();
  // One-thumb: one finger on the pad, doing what the pad says, a reaction time late.
  if (thumbMode) {
    const pad = await centre('[data-onethumb]');
    let down = false, tapped = false, lastAim = 0, aimT0 = 0;
    slidMax = 0; aimReads = 0;
    const set = async (on) => {
      if (on === down) return;
      down = on;
      await cdp.send('Input.dispatchTouchEvent', { type: on ? 'touchStart' : 'touchEnd', touchPoints: on ? [{ x: pad.x, y: pad.y, id: 1 }] : [] });
    };
    // The slide: the finger moves (it never lifts) to where the sight says, or near it.
    const slideTo = (dx, dy) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pad.x + dx, y: pad.y + dy, id: 1 }] });
    const shake = () => (Math.random() - 0.5) * 28;
    while (Date.now() - t0 < 90000) {
      const st = await page.evaluate(() => {
        const aim = document.querySelector('[data-thumb-aim]');
        return { mode: window.__coldgas.S.mode, verb: document.querySelector('[data-thumb-verb]')?.textContent || '', act: document.querySelector('[data-thumb-act]')?.textContent || '',
          aim: aim && aim.hasAttribute('data-on') ? { x: Number(aim.dataset.ex || 0), y: Number(aim.dataset.ey || 0) } : null,
          slid: Math.max(Math.abs(window.__coldgas.thumb.aim?.x || 0), Math.abs(window.__coldgas.thumb.aim?.y || 0)) };
      });
      if (st.mode !== 'live') break;
      slidMax = Math.max(slidMax, st.slid); if (st.aim) aimReads++;
      if (/let go/i.test(st.act) && !tapped) { await set(false); await sleep(REACT); await set(true); tapped = true; }
      else if (/^hold/i.test(st.verb)) { if (!down) await sleep(REACT); await set(true); }
      if (down && st.aim && skill !== 'careless' && Date.now() - lastAim > 300) {
        if (!aimT0) aimT0 = Date.now();
        lastAim = Date.now();
        await sleep(REACT);
        if (skill === 'careful') await slideTo(st.aim.x, st.aim.y);
        else { const flip = Date.now() - aimT0 < 1000 ? -1 : 1; await slideTo(2.5 * st.aim.x + shake(), flip * 2.5 * st.aim.y + shake()); }
      }
      await sleep(40);
    }
    await set(false);
  }
  while (!thumbMode && Date.now() - t0 < 90000) {
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
  const card = await page.evaluate(() => { const c = window.__coldgas.S.card; return c && { total: c.total, verdict: c.verdict, landed: !!c.facts.jumped, sink: c.facts.sink, padMiss: c.facts.padMiss, landZ: Math.round(window.__coldgas.S.run.t.landZ * 10) / 10, lateral: Math.round(window.__coldgas.S.run.t.lateral * 10) / 10, crossed: c.facts.crossedRow, tier: c.tier || (window.__coldgas.S.assist ? 'assist' : 'pro') }; });
  if (card && thumbMode) { card.slid = Math.round(slidMax * 100) / 100; card.aimReads = aimReads; }
  results.push(card);
  console.log(`run ${r + 1}:`, JSON.stringify(card));
  if (out) { await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/human-${mode}-${r + 1}.png` }); }
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.waitForTimeout(800);
}
const clean = results.filter((c) => c && c.landed && !/crash|rolled|contact|fell|deck|short|no /i.test(c.verdict) && c.sink <= 3).length;
console.log(`${mode}${thumbMode ? ` · ${skill}` : ''}: ${clean}/${RUNS} landed clean · scores ${results.map((c) => c?.total).join(' ')}`);
console.log('errors:', errors.slice(0, 5).join(' | ') || 'none');
await browser.close();
