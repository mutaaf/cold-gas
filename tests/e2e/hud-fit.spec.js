import { test, expect } from '@playwright/test';

// The telemetry strip keeps its height when the figures set a little wider (2026-10-23, red main):
// CI's Chromium drew the mono figures a hair wider than the author's, a value and its unit split onto
// two lines (655 / lb at 678×340, 16.5 / ft at 814×380, 27.9 ft/s at 393×659), the strip grew a row and
// stood into the phase tab (sideways) or the cue line (upright, full set), which are placed for its
// one-row height. Here the figures are widened by hand (0.6 px a glyph, about what that Chromium did),
// the readings are the ones CI caught, and the strip must keep to its row and clear of both.
test.describe.configure({ mode: 'parallel' });
const touch = (viewport) => ({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const WIDE = '.h-strip b, .h-strip .h-unit, .h-strip .h-alt { letter-spacing: 0.6px !important; }';

async function flyAt(browser, viewport, hud) {
  const page = await browser.newPage(touch(viewport));
  await page.addInitScript((m) => { try { localStorage.setItem('coldgas_hud', m); } catch { /* storage blocked */ } }, hud);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  await page.addStyleTag({ content: WIDE });
  return page;
}

// Sets the readings and measures in one task (no frame runs between them to redraw the HUD).
const measure = (page, { readings, air }) => page.evaluate(({ readings, air }) => {
  window.__coldgas.S.paused = true;
  const hud = document.querySelector('.hud');
  if (air) hud.setAttribute('data-air', ''); else hud.removeAttribute('data-air');
  for (const [sel, t] of Object.entries(readings)) document.querySelectorAll(sel).forEach((e) => { e.textContent = t; });
  const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
  return { strip: box('[data-hud-box="strip"]'), mission: box('[data-hud-box="mission"]'), cue: box('[data-cue]') };
}, { readings, air });

for (const [viewport, readings] of [
  [{ width: 678, height: 340 }, { '[data-speed]': '11', '[data-alt]': '32.2', '[data-air]': '655' }],
  [{ width: 814, height: 380 }, { '[data-speed]': '13', '[data-alt]': '16.5', '[data-air]': '655', '[data-g]': '1.0' }],
]) {
  test(`${viewport.width}×${viewport.height} compact: wider figures keep the band one row, under the phase tab`, async ({ browser }) => {
    const page = await flyAt(browser, viewport, 'compact');
    const m = await measure(page, { readings });
    expect(m.strip.height, JSON.stringify(m)).toBeLessThanOrEqual(48);
    expect(m.strip.top, JSON.stringify(m)).toBeGreaterThanOrEqual(m.mission.bottom - 1);
    await page.close();
  });
}

test('393×659 full: wider figures keep the strip clear of the cue line', async ({ browser }) => {
  const page = await flyAt(browser, { width: 393, height: 659 }, 'full');
  const m = await measure(page, { air: true, readings: { '[data-speed]': '25', '[data-alt]': '60.8', '[data-sink]': '27.9', '[data-air]': '564' } });
  expect(m.strip.bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.cue.top + 1);
  await page.close();
});
