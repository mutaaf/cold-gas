import { test, expect } from '@playwright/test';

// The livestream's telemetry on every screen (ticket 0018): each shown readout lies inside the
// viewport and clear of the other instruments, and the N₂ gauge reads kg, tank bar and the
// regulator's state. The numbers themselves are checked in tests/unit/hud.test.js.
const SIZES = [
  ['phone portrait', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, ['alt', 'g', 'n2', 'pitch']],
  ['phone landscape', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, ['alt', 'g', 'n2']],
  ['desktop', { viewport: { width: 1280, height: 720 } }, ['alt', 'g', 'n2', 'pitch', 'fan']],
];

for (const [name, opts, must] of SIZES) {
  test(`HUD telemetry fits and reads true: ${name}`, async ({ browser }) => {
    const page = await browser.newPage(opts);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Metric leads here: these read the sim's SI numbers straight (US-led is tests/e2e/instruments.spec.js).
    await page.addInitScript(() => localStorage.setItem('coldgas.units', 'metric'));
    await page.goto('/coldgas/?gfx=low');
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
    await page.evaluate(async () => { await window.__coldgas.physicsReady; window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.run.tick > 60, null, { timeout: 30_000 });
    const { w, h, cells, boxes } = await page.evaluate(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; };
      const shown = (el) => el.offsetParent !== null && getComputedStyle(el).display !== 'none';
      return {
        w: innerWidth, h: innerHeight,
        cells: [...document.querySelectorAll('.h-strip .h-cell')].filter(shown).map((el) => ({ ch: el.dataset.ch, ...rect(el) })),
        boxes: ['primary', 'att', 'vehicle'].map((k) => document.querySelector(`[data-hud-box="${k}"]`)).filter(shown).map(rect),
      };
    });
    const shownCh = cells.map((c) => c.ch);
    for (const ch of must) expect(shownCh, `${ch} shown`).toContain(ch);
    const strip = { x: Math.min(...cells.map((c) => c.x)), y: Math.min(...cells.map((c) => c.y)), r: Math.max(...cells.map((c) => c.r)), b: Math.max(...cells.map((c) => c.b)) };
    for (const c of [...cells, ...boxes]) {
      expect(c.x, JSON.stringify(c)).toBeGreaterThanOrEqual(0);
      expect(c.y, JSON.stringify(c)).toBeGreaterThanOrEqual(0);
      expect(c.r, JSON.stringify(c)).toBeLessThanOrEqual(w);
      expect(c.b, JSON.stringify(c)).toBeLessThanOrEqual(h);
    }
    // The strip overlaps none of the other instruments.
    for (const b of boxes) expect(b.r <= strip.x || b.x >= strip.r || b.b <= strip.y || b.y >= strip.b, JSON.stringify({ b, strip })).toBe(true);
    // N₂ full: 297 kg at 690 bar, the regulator holding line pressure; G, not "Load".
    const n2 = page.locator('[data-ch="n2"]');
    await expect(n2.locator('[data-air]')).toHaveText('297');
    await expect(n2.locator('.h-unit').first()).toHaveText('kg');
    await expect(n2.locator('[data-tank-bar]')).toHaveText('690');
    await expect(n2.locator('[data-n2-state]')).toHaveText('Reg');
    await expect(page.locator('[data-ch="g"] .h-lbl')).toHaveText('G');
    // The widest case, in both layouts (SINK takes FAN's place in the air): BLOWDOWN beside N₂ and
    // long numbers everywhere. No readout spills out of its cell. (The HUD writes only on change,
    // and none of these change on the run-up, so the values hold while measured.)
    const spills = await page.evaluate(() => {
      const hud = document.querySelector('[data-screen="hud"]'), out = [];
      const set = (sel, t) => { document.querySelector(sel).textContent = t; };
      set('[data-n2-state]', 'Blowdown'); set('[data-fan]', '4690'); set('[data-pitch]', '+170'); set('[data-sink]', '12.4');
      for (const air of [false, true]) {
        hud.toggleAttribute('data-air', air);
        for (const cell of document.querySelectorAll('.h-strip .h-cell')) {
          if (cell.offsetParent === null) continue;
          const c = cell.getBoundingClientRect();
          for (const k of cell.children) { const r = k.getBoundingClientRect(); if (r.width && (r.right > c.right + 0.5 || r.left < c.left - 0.5)) out.push(`${air ? 'air' : 'ground'} ${cell.dataset.ch} ${k.className}`); }
        }
      }
      hud.toggleAttribute('data-air', false);
      return out;
    });
    expect(spills).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
}

// The wiring, read off the page: PITCH on the deck while hanging on the ledge (the livestream's
// 170°), G settled at 1, and the gauge switching to BLOWDOWN once the tanks fall below the regulator.
test('HUD telemetry is wired: deck PITCH on the ledge, BLOWDOWN below the regulator', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('coldgas.units', 'metric'));   // kg and bar lead
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
  await page.evaluate(async () => { await window.__coldgas.physicsReady; window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); window.__coldgas.startDrill('ledge'); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.run.phase === 'ramp', null, { timeout: 30_000 });
  await expect.poll(async () => Number(await page.locator('[data-pitch]').textContent()), { timeout: 10_000 }).toBeGreaterThanOrEqual(165);
  const pitch = Number(await page.locator('[data-pitch]').textContent());
  expect(pitch).toBeLessThanOrEqual(175);
  await expect(page.locator('[data-tank]')).toHaveAttribute('data-gas', 'reg');
  // Drain the tanks to 150 kg: below the regulator (≈192 kg), so the gauge reads blowdown and bar.
  await page.evaluate(() => { window.__coldgas.S.run.car.air = 150; });
  await expect(page.locator('[data-tank]')).toHaveAttribute('data-gas', 'blowdown');
  await expect(page.locator('[data-n2-state]')).toHaveText('Blowdown');
  await expect(page.locator('[data-air]')).toHaveText(/^1[45]\d$/);
  const bar = Number(await page.locator('[data-tank-bar]').textContent());
  expect(Math.abs(bar - 690 * (Number(await page.locator('[data-air]').textContent()) / 297) ** 1.375)).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});
