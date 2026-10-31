import { test, expect } from '@playwright/test';

// 0120: one-thumb's touchdown slide and the medals. In the air the held pad turns into a sight (the
// amber dot is the mark), a slide of the held finger writes pitch / roll into the input log, and the
// results sheet shows the medal row under the score with the next target.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
const live = (page) => page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 30_000 });

test('one-thumb: in the air the pad is a sight, a slide aims, and the results show medals', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { localStorage.removeItem('coldgas_medals'); window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.evaluate(() => window.__coldgas.startDrill('ledge'));
  await live(page);
  const pad = page.locator('[data-onethumb]');
  await expect(page.locator('[data-thumb-act]')).toHaveText('Let go');
  const box = await pad.boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  // Held through the roll-out: the sight comes on once the car is roof up.
  await page.waitForFunction(() => document.querySelector('[data-thumb-aim]')?.hasAttribute('data-on'), null, { timeout: 30_000 });
  // Slide the held finger right and up: the thumb reads it.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + 40, y: at.y - 40, id: 1 }] });
  await expect.poll(() => page.evaluate(() => window.__coldgas.thumb.aim.x)).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => window.__coldgas.thumb.aim.y)).toBeGreaterThan(0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.__coldgas.thumb.aim.x)).toBe(0);   // let go: the slide is gone
  expect(errors).toEqual([]);
  await page.close();
});

test('the results sheet shows the medal row under the score, and it is kept on this device', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { localStorage.removeItem('coldgas_medals'); window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await live(page);
  // A one-thumb flight, stepped in the page: hold up the curl, stop on the ledge, tap, hold to land.
  await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    g.thumb.down();
    for (let i = 0; i < 4000 && S.mode === 'live'; i++) {
      const c = S.run.car;
      if (S.run.phase === 'ramp' && S.run.t.progress >= 0.92 && Math.hypot(c.vel.x, c.vel.y, c.vel.z) < 0.3 && !S.released) {
        g.thumb.up(); g.liveStep(0.1); g.thumb.down();
      }
      g.liveStep(0.1);
    }
    g.thumb.up();
  });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  const medals = page.locator('[data-medals]');
  await expect(medals).toBeVisible();
  await expect(medals).toContainText(/to go|Gold held/);
  // Right under the score.
  const total = await page.locator('.total-row').boundingBox(), row = await medals.boundingBox();
  expect(row.y).toBeGreaterThanOrEqual(total.y + total.height - 1);
  expect(row.y - (total.y + total.height)).toBeLessThan(40);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('coldgas_medals') || '{}'));
  expect(stored['show:assist']).toBe(await page.evaluate(() => window.__coldgas.S.card.total));
  // The reference flight is not yours: no medal row for it.
  await page.evaluate(() => { window.__coldgas.toTitle(); window.__coldgas.startRun('reveal'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await expect(medals).toBeHidden();
  expect(errors).toEqual([]);
  await page.close();
});
