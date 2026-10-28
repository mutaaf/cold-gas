import { test, expect } from '@playwright/test';

// Ticket 0106: a fold while paused, on the results, in the replay, and the resize that is not a fold. The
// mid-run folds themselves (pause, let go, Resume) are tests/e2e/fold.spec.js's. The book-style fold's sizes as
// Safari gives them (measured on the simulated device, docs/backlog/0102); touch pages at 1×.
test.describe.configure({ mode: 'parallel' });
const CLOSED = { width: 382, height: 580 }, CLOSED_SIDE = { width: 594, height: 368 };
const OPEN = { width: 669, height: 871 }, OPEN_SIDE = { width: 951, height: 589 }, SWING = { width: 466, height: 498 };
const touch = (viewport) => ({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const boot = async (page) => {
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
};
const physics = (page) => page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
// The drawing buffer fitted to the new size (the settle: 150 ms on a phone, longer on CI's software GL).
const fitted = (page, { width, height }) => page.waitForFunction(({ width, height }) => {
  const { renderer } = window.__coldgas.stage, c = renderer.domElement, pr = renderer.getPixelRatio();
  return Math.abs(c.width - Math.floor(width * pr)) <= 1 && Math.abs(c.height - Math.floor(height * pr)) <= 1;
}, { width, height }, { timeout: 10_000, polling: 50 });

// A small change is not a fold: Safari's toolbar showing or hiding (≈ 40–60 px) never pauses a run (0106).
test('a toolbar\'s worth of resize mid-run does not pause', async ({ browser }) => {
  const page = await browser.newPage(touch(OPEN));
  await boot(page);
  await physics(page);
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  await page.setViewportSize({ width: OPEN.width, height: OPEN.height + 35 });   // 669×906: the toolbar collapses
  await page.waitForTimeout(300);
  await page.setViewportSize(OPEN);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(false);
  await page.close();
});

// Paused, on the results, in the replay: a fold re-lays out whatever is up (0106). Nothing leaves the glass, the
// sheet's buttons stay reachable, and the frozen or replayed frame is drawn again (no blank canvas).
test('a fold while paused, on the results and in the replay re-lays out what is up', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(touch(CLOSED));
  await page.route('**/coldgas/api/**', (r) => r.abort());
  await boot(page);
  await physics(page);
  const inView = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden')
    .filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; }).map((e) => e.textContent.trim().slice(0, 20)), sel);
  // (A blank frame after a resize while paused is tests/e2e/lifecycle.spec.js's; here the replay keeps playing.)
  const frame = () => page.evaluate(() => window.__coldgas.S.replayT);
  // Paused → unfolded: the sheet re-fits, Resume and Home on the glass, the frozen frame drawn again.
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  for (const vp of [SWING, OPEN, CLOSED_SIDE]) {
    await page.setViewportSize(vp);
    await fitted(page, vp);
    expect(await inView('[data-screen="pause"] .actions .btn'), `${vp.width}×${vp.height}`).toEqual([]);
    expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(true);
  }
  await page.locator('[data-resume]').tap();
  // The results → folded → unfolded, then the replay → folded: the sheet (or its peek) stays on the glass.
  await page.setViewportSize(OPEN);
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-r-judges] li').length > 0, null, { timeout: 30_000 });
  await page.evaluate(() => document.querySelector('[data-theatre] .th-skip')?.click());
  for (const vp of [SWING, CLOSED, OPEN_SIDE]) {
    await page.setViewportSize(vp);
    await fitted(page, vp);
    await page.waitForTimeout(400);
    expect(await inView('.results .top-actions-row .btn'), `results ${vp.width}×${vp.height}`).toEqual([]);
  }
  await page.setViewportSize(CLOSED);
  await page.locator('[data-replay]').first().tap();
  await page.waitForFunction(() => !!document.querySelector('.results[data-peek]'), null, { timeout: 10_000 });   // the sheet folds to its peek (0068)
  for (const vp of [SWING, OPEN]) {
    await page.setViewportSize(vp);
    await fitted(page, vp);
    await page.waitForTimeout(300);
    expect(await inView('.results [data-peek] .btn'), `replay ${vp.width}×${vp.height}`).toEqual([]);
    const t = await frame();
    await page.waitForFunction((t) => window.__coldgas.S.replayT !== t || !document.querySelector('.results[data-peek]'), t, { timeout: 10_000 });   // the replay plays on
  }
  await page.close();
});
