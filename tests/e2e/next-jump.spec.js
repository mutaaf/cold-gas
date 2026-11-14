import { test, expect } from '@playwright/test';

// 0257: after a landing the sheet leads with Next jump (the next event: Show → Wall → Lineup), then Beat <score>
// (Retry, with the score to beat), then Share; a wreck leads with Retry and has no Next. Enter is the primary, R
// retries, N is Next. The calm sheet (a first run's) keeps the order. Runs are stepped from the test: the reference
// autopilot flies the player's Jump to its card (a landing), or full throttle with no release (a wreck).
test.slow();

async function boot(page, { firstVisit = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (firstVisit) await page.addInitScript(() => { if (!localStorage.getItem('coldgas_howto')) localStorage.setItem('coldgas_howto', 'new'); });
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
  return errors;
}
const fly = (page, { crash = false } = {}) => page.evaluate(({ crash }) => {
  const g = window.__coldgas, S = g.S;
  S.holdLive = true;
  g.startRun('jump', true);
  S.autopilot = crash ? () => ({ throttle: 1, assist: 1 }) : g.createAutopilot(g.stage.course);
  g.skipCountdown();
  for (let i = 0; i < 4000 && !S.card; i++) g.liveStep(0.1);
  S.autopilot = null;
  for (let i = 0; i < 4000 && S.mode !== 'results'; i++) g.liveStep(0.1);
  S.holdLive = false;
  return { course: S.run.course, total: S.card.total, crashed: !!S.card.facts.crashed, landed: !!S.card.facts.jumped && !S.card.facts.crashed, mode: S.mode };
}, { crash });
// The sheet's action row as a player sees it, left to right / top to bottom.
const row = (page) => page.evaluate(() => [...document.querySelectorAll('.results .top-actions-row > .btn')]
  .filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none')
  .map((b) => ({ k: b.matches('[data-next]') ? 'next' : b.matches('[data-again]') ? 'again' : b.matches('[data-share]') ? 'share' : b.matches('[data-replay]') ? 'replay' : b.matches('[data-home]') ? 'home' : '?', text: b.textContent.trim(), y: Math.round(b.getBoundingClientRect().top), x: Math.round(b.getBoundingClientRect().left) }))
  .sort((a, b) => a.y - b.y || a.x - b.x));

test('1280×720 keyboard: a landing leads with Next jump (focused), Beat <score>, Share; R retries; N flies the next event', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await boot(page);
  await page.keyboard.press('KeyG');   // a key: the device is the keyboard
  await page.keyboard.press('KeyG');
  const one = await fly(page);
  expect(one.landed).toBe(true);
  const r = await row(page);
  expect(r.slice(0, 3).map((b) => b.k)).toEqual(['next', 'again', 'share']);
  expect(r[0].text).toContain('Next jump');
  expect(r[0].text).toContain('The Wall');
  expect(r[1].text).toContain(`Beat ${one.total.toFixed(1)}`);
  expect(await page.evaluate(() => document.activeElement?.matches('[data-next]'))).toBe(true);
  // R still retries, on the same event.
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('show');
  // A wreck: Retry leads, no Next, and Enter retries.
  const w = await fly(page, { crash: true });   // full throttle at the Wall, never let go
  expect(w.landed).toBe(false);
  const rw = await row(page);
  expect(rw[0].k).toBe('again');
  expect(rw[0].text).toContain('Retry');
  expect(rw.map((b) => b.k)).not.toContain('next');
  expect(rw.slice(0, 2).map((b) => b.k)).toEqual(['again', 'share']);
  await page.locator('body').press('Enter');
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('show');
  expect((await fly(page)).landed).toBe(true);
  // N: the next event, at once.
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => ({ course: window.__coldgas.S.run.course, stage: window.__coldgas.stage.course, kind: window.__coldgas.S.runKind }))).toEqual({ course: 'wall', stage: 'wall', kind: 'jump' });
  expect(errors).toEqual([]);
});

test('390×844, a first run: the calm sheet keeps the order, Next under the thumb, one tap flies the Wall', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = await boot(page, { firstVisit: true });
  await fly(page);
  await expect(page.locator('[data-screen="results"]')).toHaveAttribute('data-calm', '');
  const r = await row(page);
  expect(r.slice(0, 3).map((b) => b.k)).toEqual(['next', 'again', 'share']);
  const next = page.locator('.results [data-next]');
  await expect(next).toBeInViewport();
  expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.activeElement?.matches('[data-next]'))).toBe(false);   // no focus ring for a finger
  await next.tap();
  await page.waitForFunction(() => ['countdown', 'live'].includes(window.__coldgas.S.mode));
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('wall');
  expect(errors).toEqual([]);
  await page.close();
});
