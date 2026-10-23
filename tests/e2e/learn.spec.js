import { test, expect } from '@playwright/test';

// The skill ladder in the browser: drills start anywhere and retry on one key, the landing HUD is
// up in the air, Advanced puts each valve on its own key, and on a phone on its own pad.
const IDX = { 'down-fr': 0, 'down-fl': 1, 'down-rr': 2, 'down-rl': 3 };   // src/sim/spec.js NOZZLE_SPEC order
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
const live = (page) => page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 30_000 });

test('a drill starts from the practice sheet and R retries it from the same start', async ({ page }) => {
  // Slow but correct: a drill's start flies the reference flight on the main thread (ticket 0043
  // moves it off the tap), which on CI's software GL took 52 s of a 60 s budget before any change.
  test.slow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-practice-open]').click();
  await expect(page.locator('[data-screen="practice"]')).toBeVisible();
  await expect(page.locator('[data-drill]')).toHaveCount(4);
  await page.locator('[data-drill="release"]').click();
  await live(page);
  await expect(page.locator('[data-drill-bar]')).toBeVisible();
  await expect(page.locator('[data-drill-bar]')).toContainText('not scored');
  const start = await page.evaluate(() => window.__coldgas.S.run.drillStartTick);
  await page.waitForFunction((t) => window.__coldgas.S.run.tick > t + 30, start, { timeout: 30_000 });
  const before = await page.evaluate(() => { window.__first = window.__coldgas.S.run; return window.__coldgas.S.run.tick; });
  await page.keyboard.press('KeyR');
  const after = await page.evaluate(() => ({ fresh: window.__coldgas.S.run !== window.__first, tick: window.__coldgas.S.run.tick, start: window.__coldgas.S.run.drillStartTick, drill: window.__coldgas.S.drill?.id }));
  expect(after.fresh).toBe(true);
  expect(after.drill).toBe('release');
  expect(after.start).toBe(start);
  expect(after.tick).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test('the landing HUD is up in the air: the sink in its band, the BRAKE line, the touchdown marker', async ({ page }) => {
  // Slow but correct: a drill's start flies the reference on the main thread, then the run is flown
  // out to the coach's card; on CI's software GL that took 57 s of a 60 s budget.
  test.slow();
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('pro'); window.__coldgas.startDrill('land'); });
  await live(page);
  // The marker first: since SIM_VERSION 15 the reference brakes late, so the drill starts at the
  // fastest point of the fall and is under 0.6 s from the ground with hands off.
  await page.waitForFunction(() => window.__coldgas.landing.marker.visible, null, { timeout: 5_000 });
  await expect(page.locator('[data-descent]')).toBeVisible();
  await expect(page.locator('[data-d-sink]')).toHaveText(/^\d+\.\d$/);
  await expect(page.locator('[data-descent]')).toHaveAttribute('data-status', /green|amber|red/);
  await expect(page.locator('[data-d-brake-lbl]')).toContainText('BRAKE');
  // Hands off from 10 m, falling 13 m/s: the band goes red before the ground.
  await page.waitForFunction(() => document.querySelector('[data-descent]').dataset.status === 'red' || window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  // (The crash's slow-motion beat takes minutes of wall clock on a software-GL runner: skip ahead.)
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await expect(page.locator('[data-coach]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-coach-items] li').first()).toBeVisible();
  // Hands off from the hand-over: nothing the reference did before it is credited to you.
  await expect(page.locator('[data-fix="no-brake"]')).toBeVisible();
  await page.evaluate(() => window.__coldgas.setTier('assist'));
});

test('Advanced on a keyboard: Q opens the front-left down-jet and only that one', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('advanced'); window.__coldgas.startDrill('release'); });
  await expect(page.locator('button[data-tier]')).toContainText('×1.15');
  await live(page);
  await page.keyboard.down('KeyQ');
  await page.waitForFunction((i) => window.__coldgas.S.run.car.throttles[i] > 0.3, IDX['down-fl'], { timeout: 30_000 });
  const thr = await page.evaluate(() => [...window.__coldgas.S.run.car.throttles]);
  await page.keyboard.up('KeyQ');
  expect(thr[IDX['down-fl']]).toBeGreaterThan(0.3);
  for (const id of ['down-fr', 'down-rl', 'down-rr']) expect(thr[IDX[id]]).toBeLessThan(0.05);
  // The log carries it as a valve channel, in an Advanced run.
  const logged = await page.evaluate(() => window.__coldgas.S.run.inputLog.some((e) => e.length === 24 && e[13] === 100 && e[15] > 0));
  expect(logged).toBe(true);
  await page.evaluate(() => window.__coldgas.setTier('assist'));
});

test('Advanced on a phone: the nozzle pad, multi-touch, a pad per valve', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('advanced'); window.__coldgas.startDrill('release'); });
  await live(page);
  const pad = page.locator('[data-nozzle-pad]');
  await expect(pad).toBeVisible({ timeout: 15_000 });
  await expect(pad).toBeInViewport();
  await expect(page.locator('[data-nozzle-pad] [data-pad]')).toHaveCount(13);   // ten nozzles, three chords
  const box = await page.locator('[data-nozzle-pad] svg').boundingBox();
  const at = (x, y) => ({ x: box.x + (x / 300) * box.width, y: box.y + (y / 380) * box.height });
  const cdp = await page.context().newCDPSession(page);
  // Two thumbs: front-left (Q) and front-right (E).
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at(58, 116), id: 1 }, { ...at(242, 116), id: 2 }] });
  await page.waitForFunction((i) => window.__coldgas.S.run.car.throttles[i[0]] > 0.3 && window.__coldgas.S.run.car.throttles[i[1]] > 0.3, [IDX['down-fl'], IDX['down-fr']], { timeout: 30_000 });
  const thr = await page.evaluate(() => [...window.__coldgas.S.run.car.throttles]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(thr[IDX['down-rl']]).toBeLessThan(0.05);
  await page.evaluate(() => window.__coldgas.setTier('assist'));
  await page.close();
});
