import { test, expect } from '@playwright/test';

// 0247: a first visit (no landed Jump on this device) is flying within about three seconds: one tap on Jump, no how-to
// card, one beat of GO; the title leads with Jump alone (the reference, Practice, the board and the settings wait under
// "More ways to play"); and a ?play=reveal link is a taste of the reference, then the player's own Jump. A player who
// has landed a Jump gets today's title, card and reference run.
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

export async function boot(page, { landed = false, url = '/coldgas/?gfx=low' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((landed) => {
    window.boxoffice = { calls: [], track(name, props) { this.calls.push([name, props]); } };
    // An automated browser is otherwise a returning player.
    if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new');
    if (landed) localStorage.setItem('coldgas_landings', '1');
  }, landed);
  await page.goto(url);
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  return errors;
}
const shown = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'), sel);

test('first visit, phone: one tap on Jump flies, no card, and the car answers a thumb within 3 s', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page);
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });   // the game's clock, not SwiftShader's frame time
  // The title: Jump alone; the rest under More ways to play.
  await expect(page.locator('[data-screen="title"]')).toHaveAttribute('data-first', '');
  await expect(page.locator('[data-start]')).toBeInViewport();
  for (const sel of ['[data-reveal]', '[data-practice-open]', '[data-board-open]', '[data-assist-open]']) expect(await shown(page, `[data-screen="title"] ${sel}`), sel).toBe(false);
  await page.locator('[data-play-more] summary').tap();
  await expect(page.locator('[data-screen="title"] [data-reveal]')).toBeVisible();
  await page.locator('[data-play-more] summary').tap();
  const t0 = Date.now();
  await page.locator('[data-start]').tap();
  expect(await shown(page, '[data-screen="howto"]')).toBe(false);
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 10_000 });
  const pad = await page.locator('[data-onethumb]').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pad.x + pad.width / 2, y: pad.y + pad.height / 2, id: 1 }] });
  await page.waitForFunction(() => { const c = window.__coldgas.S.run?.car; return !!c && Math.hypot(c.vel.x, c.vel.z) > 0.5; }, null, { timeout: 10_000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // first_input (0245) is the Jump tap.
  await page.evaluate(() => window.__coldgas.toTitle());
  const first = await page.evaluate(() => window.boxoffice.calls.find(([n]) => n === 'first_input'));
  expect(first?.[1].ms_since_load).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.close();
});

test('first visit: ?play=reveal is a taste of the reference, then the player’s own Jump from the mark', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page, { url: '/coldgas/?play=reveal&gfx=low' });
  await page.waitForFunction(() => !!window.__coldgas.S.run, null, { timeout: 30_000 });
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    S.holdLive = true;
    g.skipCountdown();
    const was = { kind: S.runKind, taste: S.taste };
    let t = 0;
    for (; t < 60 && S.runKind === 'reveal'; t += 0.05) g.liveStep(0.05);
    return { was, t, kind: S.runKind, mode: S.mode, autopilot: !!S.autopilot, touch: !document.querySelector('[data-touch]').hidden };
  });
  expect(r.was).toEqual({ kind: 'reveal', taste: true });
  expect(r.kind).toBe('jump');
  expect(r.mode).toBe('countdown');
  expect(r.autopilot).toBe(false);
  expect(r.touch).toBe(true);
  expect(r.t).toBeLessThan(25);   // a taste, not the whole run
  await expect(page.locator('[data-cue]')).toContainText('Your turn');
  expect(errors).toEqual([]);
  await page.close();
});

test('a landed Jump stored: today’s title, the how-to card on Jump, and ?play=reveal is the whole reference run', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = await boot(page, { landed: true });
  await expect(page.locator('[data-screen="title"]')).not.toHaveAttribute('data-first', '');
  for (const sel of ['[data-reveal]', '[data-practice-open]', '[data-board-open]']) await expect(page.locator(`[data-screen="title"] ${sel}`)).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('[data-screen="title"] .cta-row').parentElement.classList.contains('cta'))).toBe(true);
  await page.locator('[data-start]').tap();
  await expect(page.locator('[data-howto-go]')).toBeVisible();   // a player who never saw how to fly sees it, as today
  await page.goto('/coldgas/?play=reveal&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.() && !!window.__coldgas.S.run, null, { timeout: 60_000 });
  const r = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S;
    S.holdLive = true;
    g.skipCountdown();
    for (let i = 0; i < 8000 && S.mode === 'live'; i++) g.liveStep(0.05);
    return { kind: S.runKind, mode: S.mode, taste: !!S.taste };
  });
  expect(r).toEqual({ kind: 'reveal', mode: 'results', taste: false });
  expect(errors).toEqual([]);
  await page.close();
});
