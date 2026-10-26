import { test, expect } from '@playwright/test';

// Easy on the battery (0049): the title draws at ~30 fps, and while a run is on (the canvas changes every
// frame) nothing blurs the canvas behind it and the grain's full-screen blend is off. The pacing itself
// is unit-tested at every display rate (tests/unit/pace.test.js): software GL can't draw past 30 here.
const G = (page, fn, arg) => page.evaluate(fn, arg);
const blurred = (page) => G(page, () => [...document.querySelectorAll('body *')].filter((el) => {
  const cs = getComputedStyle(el);
  const f = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
  return f !== 'none' && el.getClientRects().length > 0;
}).map((el) => el.className || el.tagName));

test('the title draws at no more than 30 fps; flying, no backdrop blur and no grain', async ({ page }) => {
  test.slow();   // boot, two seconds of title frames and a run's first frames on software GL: past 60 s under load
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'title');
  await expect(page.locator('.grain')).toBeVisible();   // the title keeps its film grain
  // Frames drawn against animation frames over two seconds of the title.
  const r = await G(page, () => new Promise((res) => {
    const info = window.__coldgas.stage.renderer.info.render;
    const f0 = info.frame, t0 = performance.now();
    let raf = 0;
    const tick = () => {
      raf++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
      else res({ drawn: info.frame - f0, raf, secs: (performance.now() - t0) / 1000 });
    };
    requestAnimationFrame(tick);
  }));
  expect(r.drawn, JSON.stringify(r)).toBeGreaterThan(0);
  expect(r.drawn / r.secs, JSON.stringify(r)).toBeLessThanOrEqual(31);
  expect(r.drawn, JSON.stringify(r)).toBeLessThanOrEqual(r.raf);

  await G(page, () => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'live');
  await expect(page.locator('.grain')).toBeHidden();
  await expect(page.locator('.hud')).toBeVisible();
  await expect.poll(() => blurred(page), { timeout: 5000 }).toEqual([]);   // the top bar's chips ease out of theirs (transition: all)
  // The HUD's strip still has its glass: a solid fill now, not a see-through one.
  const strip = await G(page, () => getComputedStyle(document.querySelector('.h-strip')).backgroundColor);
  expect(strip).toMatch(/rgba\(5, 7, 12, 0\.7\d*\)/);
  // The results keep the title's look: without the grain and the blur there, software GL's main thread fell
  // seconds behind and the judges' theatre missed its deadlines (smoke.spec, theatre.spec).
  await G(page, () => window.__coldgas.fastForward());
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'results', { timeout: 30_000 });
  await expect(page.locator('.grain')).toBeVisible();
  expect(errors).toEqual([]);
});
