import { test, expect } from '@playwright/test';

// The instruments answer a tap: both unit systems on every readout (US leading by default, a tap
// swaps which leads and it's kept), the damage map opens up, the G meter and friends open their
// readouts, and Free Drive's minimap opens the full map. None of it pauses the run.
// Booting the stage and running 60 ticks on CI's software GL, beside the other workers, can take
// more than 30 s: these get test.slow() and a minute for the first frames. Nothing is optional.
const live = async (page, opts = {}) => {
  test.slow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (opts.units) await page.addInitScript((u) => localStorage.setItem('coldgas.units', u), opts.units);
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.evaluate(async () => { await window.__coldgas.physicsReady; window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.run.tick > 60, null, { timeout: 60_000 });
  return errors;
};

test('both unit systems show, US leading; a tap swaps which leads, and it is kept', async ({ page }) => {  const errors = await live(page);
  const spd = page.locator('[data-ch="spd"]');
  await expect(spd.locator('.h-unit')).toHaveText('mph');
  await expect(spd.locator('[data-2="speed"]')).toBeVisible();
  await expect(spd.locator('[data-2="speed"]')).toHaveText(/^\d+ km\/h$/);
  await expect(page.locator('[data-ch="alt"] .h-unit')).toHaveText('ft');
  await expect(page.locator('[data-ch="alt"] [data-2="alt"]')).toHaveText(/ m$/);
  await expect(page.locator('[data-ch="n2"] .h-unit').first()).toHaveText('lb');
  await expect(page.locator('[data-ch="n2"] [data-2="kg"]')).toHaveText('297 kg');
  await expect(page.locator('[data-ch="n2"] [data-air]')).toHaveText('655');
  // The title's spec reads both too (US first).
  await expect(page.locator('.spec dd[data-u-src]').first()).toContainText('655 lb');
  await expect(page.locator('.spec dd[data-u-src]').first()).toContainText('297 kg');
  // Speed agrees with the sim in both.
  const { mph, kmh, v } = await page.evaluate(() => {
    const c = window.__coldgas.S.run.car;
    return { v: Math.hypot(c.vel.x, c.vel.y, c.vel.z), mph: Number(document.querySelector('[data-speed]').textContent), kmh: parseFloat(document.querySelector('[data-2="speed"]').textContent) };
  });
  expect(Math.abs(mph - v * 2.237)).toBeLessThan(4);
  expect(Math.abs(kmh - mph * 1.609)).toBeLessThan(3);

  // One tap on the speed readout: metric leads everywhere, US is beside it.
  await spd.click();
  await expect(spd.locator('.h-unit')).toHaveText('km/h');
  await expect(spd.locator('[data-2="speed"]')).toHaveText(/ mph$/);
  await expect(page.locator('[data-ch="alt"] .h-unit')).toHaveText('m');
  await expect(page.locator('[data-ch="n2"] [data-air]')).toHaveText('297');
  expect(await page.evaluate(() => localStorage.getItem('coldgas.units'))).toBe('metric');
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(false);
  // Kept across a reload.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__coldgas?.stage && document.documentElement.dataset.unitSys, null, { timeout: 60_000 });
  expect(await page.evaluate(() => [localStorage.getItem('coldgas.units'), document.documentElement.dataset.unitSys])).toEqual(['metric', 'metric']);
  await expect(page.locator('[data-ch="spd"] .h-unit')).toHaveText('km/h');
  await expect(page.locator('.spec dd[data-u-src]').first()).toContainText('297 kg');
  // U swaps it back.
  await page.keyboard.press('KeyU');
  await expect(page.locator('[data-ch="spd"] .h-unit')).toHaveText('mph');
  expect(errors).toEqual([]);
});

test('the damage map opens up, a zone focuses, Escape closes it, and the run never pauses', async ({ page }) => {
  const errors = await live(page);
  const t0 = await page.evaluate(() => window.__coldgas.S.run.tick);
  await page.locator('[data-dmg]').click();
  const view = page.locator('.dmv');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-v-int]')).toHaveText('100');
  // The HUD steps back under it: nothing reads through the glass.
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-hud-box="strip"]')).opacity))).toBeLessThan(0.3);
  await expect(view.locator('[data-zone]')).toHaveCount(7);
  await expect(view).toContainText('What damage does');
  await view.locator('[data-zone="nose"]').click();
  await expect(view.locator('[data-zone="nose"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('[data-v-hits-h]')).toHaveText('Hits · Nose');
  // A hit lands: the list and the HUD's flash show it, in both units.
  await page.evaluate(() => {
    const { S } = window.__coldgas, c = S.run.car;
    const m = c.impacts, i = m.count++;
    m.tick[i] = c.tick; m.kind[i] = 0; m.part[i] = 1; m.probe[i] = 0; m.body[i] = -1;
    m.x[i] = c.pos.x; m.y[i] = c.pos.y; m.z[i] = c.pos.z + 2; m.nx[i] = 0; m.ny[i] = 0; m.nz[i] = -1; m.speed[i] = 6; m.crush[i] = 0;
  });
  await expect(view.locator('[data-v-list] li').first()).toContainText('mph');
  await expect(view.locator('[data-v-list] li').first()).toContainText('km/h');
  await expect(page.locator('[data-dmg-fx]')).toHaveClass(/on/);
  expect(await page.evaluate(() => window.__coldgas.S.run.tick)).toBeGreaterThan(t0);
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-hud-box="strip"]')).opacity))).toBe(1);
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('live');
  expect(errors).toEqual([]);
});

test('every instrument answers: G peak, burn time, splits, attitude, thrusters', async ({ page }) => {
  const errors = await live(page);
  for (const [sel, text] of [['[data-ch="g"]', 'G load'], ['[data-ch="n2"] .h-lbl', 'Nitrogen'], ['[data-clock]', 'splits'], ['[data-hud-box="att"]', 'Attitude'], ['.h-array', 'Thrusters']]) {
    await page.locator(sel).first().click();
    await expect(page.locator('.ipop')).toBeVisible();
    await expect(page.locator('.ipop')).toContainText(new RegExp(text, 'i'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.ipop')).toBeHidden();
  }
  // Keyboard: Enter on a focused instrument opens it.
  await page.locator('[data-ch="g"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ipop')).toContainText('Highest this flight');
  expect(await page.evaluate(() => window.__coldgas.S.mode)).toBe('live');
  expect(errors).toEqual([]);
});

// The widest US-led readouts fit their cells (the metric-led case is tests/e2e/hud.spec.js).
for (const [name, opts] of [['phone portrait', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }], ['desktop', { viewport: { width: 1280, height: 720 } }]]) {
  test(`US-led readouts with metric beside them fit: ${name}`, async ({ browser }) => {
    const page = await browser.newPage(opts);
    const errors = await live(page);
    // Twice: in the bundled faces, then in a wide fallback monospace forced over the HUD (CI's
    // Linux fonts ran wider than a Mac's), so a layout that only just fits fails here too.
    const measure = () => page.evaluate(() => {
      const hud = document.querySelector('[data-screen="hud"]'), out = [];
      const set = (sel, t) => { document.querySelector(sel).textContent = t; };
      set('[data-n2-state]', 'Blowdown'); set('[data-fan]', '10341'); set('[data-2="fan"]', '4690 kgf'); set('[data-pitch]', '+170'); set('[data-sink]', '40.7'); set('[data-2="sink"]', '12.4 m/s');
      set('[data-speed]', '188'); set('[data-2="speed"]', '302 km/h'); set('[data-alt]', '91.9'); set('[data-2="alt"]', '28.0 m');
      for (const air of [false, true]) {
        hud.toggleAttribute('data-air', air);
        for (const cell of document.querySelectorAll('.h-strip .h-cell')) {
          if (cell.offsetParent === null) continue;
          const c = cell.getBoundingClientRect();
          for (const k of cell.querySelectorAll('*')) { const r = k.getBoundingClientRect(); if (r.width && (r.right > c.right + 0.5 || r.left < c.left - 0.5)) out.push(`${air ? 'air' : 'ground'} ${cell.dataset.ch} ${k.className}`); }
        }
      }
      hud.toggleAttribute('data-air', false);
      return out;
    });
    expect(await measure(), 'bundled fonts').toEqual([]);
    await page.addStyleTag({ content: '.hud, .hud * { font-family: "Courier New", "DejaVu Sans Mono", "Liberation Mono", monospace !important; letter-spacing: 0.03em !important; }' });
    expect(await measure(), 'a wide fallback monospace').toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
}

test('Free Drive: the minimap opens the full map, a tap reads the road, Escape closes it without pausing', async ({ page }) => {
  test.slow();   // building a road world on CI's software GL takes a while
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low&drive=stelvio');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  await expect(page.locator('.fd-speed [data-u="speed"]')).toHaveText('mph');
  await expect(page.locator('[data-h-speed2]')).toHaveText(/km\/h$/);
  await expect(page.locator('[data-h-ele2]')).toHaveText(/ m$/);
  await expect(page.locator('[data-h-minic]')).toBeVisible();
  // The canvas is drawn at the screen's pixel density.
  expect(await page.evaluate(() => { const c = document.querySelector('[data-h-minic]'); return c.width / c.clientWidth; })).toBeCloseTo(await page.evaluate(() => Math.min(3, devicePixelRatio)), 1);
  await page.locator('[data-h-map]').click();
  const map = page.locator('.fd-xmap');
  await expect(map).toBeVisible();
  await expect(map.locator('[data-xm-togo]')).toHaveText(/mi · .*km/);
  // The driving HUD under the map is inert and out of sight while it's open.
  expect(await page.evaluate(() => document.querySelector('[data-drive-hud]').inert)).toBe(true);
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-drive-hud]')).opacity))).toBeLessThan(0.05);
  // A tap on the elevation profile reads the road there: distance, elevation (ft first), grade.
  const box = await map.locator('[data-xm-prof]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(map.locator('[data-xm-tip]')).toBeVisible();
  await expect(map.locator('[data-xm-tip]')).toContainText('ft');
  await expect(map.locator('[data-xm-tip]')).toContainText('Grade');
  // Wheel zoom changes the view without closing it.
  const mb = await map.locator('[data-xm-map]').boundingBox();
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(map).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
  expect(await page.evaluate(() => window.__coldgas.drive.paused)).toBe(false);
  expect(await page.evaluate(() => document.querySelector('[data-drive-hud]').inert)).toBe(false);
  // M opens it again.
  await page.keyboard.press('KeyM');
  await expect(map).toBeVisible();
  expect(errors).toEqual([]);
});
