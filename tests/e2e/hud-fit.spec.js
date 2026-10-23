import { test, expect } from '@playwright/test';

// The telemetry strip keeps its height when the figures set a little wider (2026-10-23, red main):
// CI's Chromium drew the mono figures a hair wider than the author's, a value and its unit split onto
// two lines (655 / lb at 678×340, 16.5 / ft at 814×380, 27.9 ft/s at 393×659), the strip grew a row and
// stood into the phase tab (sideways) or the cue line (upright, full set), which are placed for its
// one-row height. Here the figures are set to a fixed width whatever this Chromium's own (the mono
// advance taken to 0.6375 em: Geist Mono's 0.6 em and 0.6 px at 16 px, about what CI's did), the
// readings are the ones CI caught, and the strip must keep to its row and clear of both.
test.describe.configure({ mode: 'parallel' });
const touch = (viewport) => ({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const MONO = '.h-strip b, .h-strip .h-unit, .h-strip .h-alt, .h-strip [data-tank-bar], .h-strip [data-u="press"]';
const ADVANCE = 0.6375;   // em

// A notched phone sideways, as scripts/hud-audit.mjs forces it (the `s` viewports).
const NOTCH = ':root { --safe-t: 0px !important; --safe-l: 47px !important; --safe-r: 47px !important; --safe-b: 21px !important; }';

async function flyAt(browser, viewport, hud, { notch = false } = {}) {
  const page = await browser.newPage(touch(viewport));
  await page.addInitScript((m) => { try { localStorage.setItem('coldgas_hud', m); } catch { /* storage blocked */ } }, hud);
  if (notch) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }), NOTCH);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  // The page's own mono advance (fonts loaded), then letter-spacing to make up the fixed width.
  const extra = await page.evaluate(async (want) => {
    await document.fonts.ready;
    const cx = document.createElement('canvas').getContext('2d');
    cx.font = `16px ${getComputedStyle(document.querySelector('.h-strip b')).fontFamily}`;
    return Math.max(0, want - cx.measureText('0'.repeat(20)).width / 20 / 16);
  }, ADVANCE);
  await page.addStyleTag({ content: `${MONO} { letter-spacing: ${extra.toFixed(4)}em !important; }` });
  return page;
}

// N₂'s second line as on a full tank (its longest), whenever the run is measured.
const FULL_TANK = { '[data-2="kg"]': '297 kg', '[data-tank-bar]': '10.0k', '[data-2="bar"]': '690\u00a0bar' };
// Sets the readings and measures in one task (no frame runs between them to redraw the HUD).
const measure = (page, { readings, air, damage }) => page.evaluate(({ readings, air, damage }) => {
  window.__coldgas.S.paused = true;
  const hud = document.querySelector('.hud');
  if (air) hud.setAttribute('data-air', ''); else hud.removeAttribute('data-air');
  if (damage) hud.setAttribute('data-damage', damage);
  for (const [sel, t] of Object.entries(readings)) document.querySelectorAll(sel).forEach((e) => { e.textContent = t; });
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
  return { strip: box('[data-hud-box="strip"]'), mission: box('[data-hud-box="mission"]'), cue: box('[data-cue]') };
}, { readings: { ...FULL_TANK, ...readings }, air, damage });

// 678×340: a folding phone closed, sideways (a 239 px band). 814×380 with the notch: the wreck on the
// ground CI caught (281 px; G steps out and the damage cell stands in its place).
for (const [name, viewport, opts, state] of [
  ['678×340', { width: 678, height: 340 }, {}, { readings: { '[data-speed]': '11', '[data-alt]': '32.2', 'b[data-air]': '655' } }],
  ['814×380 notch, wrecked', { width: 814, height: 380 }, { notch: true },
    { damage: 'wreck', readings: { '[data-speed]': '13', '[data-alt]': '16.5', 'b[data-air]': '655', '[data-dmg-word2]': 'Wrecked', '[data-dmg-pct2]': '66' } }],
]) {
  test(`${name} compact: wider figures keep the band one row, under the phase tab`, async ({ browser }) => {
    const page = await flyAt(browser, viewport, 'compact', opts);
    const m = await measure(page, state);
    expect(m.strip.height, JSON.stringify(m)).toBeLessThanOrEqual(48);
    expect(m.strip.top, JSON.stringify(m)).toBeGreaterThanOrEqual(m.mission.bottom - 1);
    await page.close();
  });
}

test('393×659 full: wider figures keep the strip clear of the cue line', async ({ browser }) => {
  const page = await flyAt(browser, { width: 393, height: 659 }, 'full');
  const m = await measure(page, { air: true, readings: { '[data-speed]': '25', '[data-alt]': '60.8', '[data-sink]': '27.9', 'b[data-air]': '564' } });
  expect(m.strip.bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.cue.top + 1);
  await page.close();
});
