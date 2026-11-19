import { test, expect } from '@playwright/test';

// 0143: the players' funnel sees a visit that ends on the title. A first visit on a phone (390×844 touch,
// coldgas_howto = 'new'); the page "goes" by a pagehide event, and every beacon's play counts are kept as the page hands
// them to flush (on localhost nothing is sent).
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function boot(browser, { holdPhysics = false } = {}) {
  const page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let release = () => {};
  if (holdPhysics) {
    const held = new Promise((r) => { release = r; });
    await page.route(/rapier3d-[^/]*\.js$/, async (route) => { await held; await route.continue(); });
  }
  await page.addInitScript(() => { if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new'); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S, null, { timeout: 90_000 });
  await page.evaluate(() => {
    const obs = window.__coldgas.obs, f = obs.flush;
    window.__beacons = [];
    obs.flush = (reason, o) => { const p = f(reason, o); window.__beacons.push({ reason, play: p?.play || {} }); return p; };
  });
  return { page, errors, release };
}
// Everything the page counted this load, summed over its beacons (the visit itself is sent at once on some runners).
const leave = (page) => page.evaluate(() => {
  dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  const all = {};
  for (const b of window.__beacons) for (const [k, n] of Object.entries(b.play)) all[k] = (all[k] || 0) + n;
  for (const [k, n] of Object.entries(window.__coldgas.obs.plays)) if (!(k in all)) all[k] = n;
  return all;
});
const leaves = (play) => Object.keys(play).filter((k) => k === 'title-left' || k.startsWith('left-')).sort();

test('a first visit that looks and leaves posts one title-left with left-title, once', async ({ browser }) => {
  const { page, errors } = await boot(browser);
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  await page.evaluate(() => window.__coldgas.stage.ready);
  let play = await leave(page);
  expect(leaves(play)).toEqual(['left-title', 'title-left']);
  expect(play['title-left']).toBe(1);
  expect(play['jump-tap'] ?? 0).toBe(0);
  play = await leave(page);   // gone again: still one
  expect(play['title-left']).toBe(1);
  expect(play['title-back'] ?? 0).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

test('a phone that goes hidden with the how-to card open (no pagehide) says left-howto on that beacon', async ({ browser }) => {
  const { page, errors } = await boot(browser);
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  // A first visit's title keeps How to fly under "More ways to play" (0247).
  const howto = page.locator('[data-screen="title"] [data-howto-open]').first();
  if (!(await howto.isVisible())) await page.locator('[data-play-more] summary').tap();
  await howto.tap();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  // A phone tab switched away: hidden, then frozen and discarded with no pagehide.
  const hid = await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__beacons.at(-1);
  });
  expect(hid.reason).toBe('hidden');
  expect(leaves(hid.play)).toEqual(['left-howto', 'title-left']);
  expect(errors).toEqual([]);
  await page.close();
});

test('Jump tapped while the engine loads, then the page goes: jump-tap once and left-starting; back and flying, title-back takes it back', async ({ browser }) => {
  const { page, errors, release } = await boot(browser, { holdPhysics: true });
  expect(await page.evaluate(() => window.__coldgas.physicsReady())).toBe(false);
  const jump = page.locator('[data-start]');
  await jump.tap();
  await jump.tap();
  await expect(jump).toHaveAttribute('data-pending', '');
  let play = await leave(page);
  expect(play['jump-tap']).toBe(1);
  expect(leaves(play)).toEqual(['left-starting', 'title-left']);
  release();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 90_000 });
  play = await leave(page);
  expect(play.run).toBe(1);
  expect(play['title-left']).toBe(1);   // once a load…
  expect(play['title-back']).toBe(1);   // …and taken back: that page came back (bfcache, an app switch) and flew
  expect(errors).toEqual([]);
  await page.close();
});

test('a visit whose Jump reaches a run posts jump-tap and run, and no title-left', async ({ browser }) => {
  const { page, errors } = await boot(browser);
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 90_000 });
  await page.locator('[data-start]').tap();
  const go = page.locator('[data-howto-go]');
  if (await go.isVisible()) await go.tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.toTitle());   // back on the title, then gone: it reached a run
  const play = await leave(page);
  expect(play).toMatchObject({ 'jump-tap': 1, run: 1 });
  expect(leaves(play)).toEqual([]);
  expect(errors).toEqual([]);
  await page.close();
});
