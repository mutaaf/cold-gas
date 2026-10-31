import { test, expect } from '@playwright/test';

// 0057: a network blip never breaks Free Drive, the Sandbox or the judges for the rest of the session.
// Chromium remembers a failed dynamic import (the same URL fails again with no request), so a retry asks for the
// failed chunk with a query; a shared chunk it can't re-ask that way costs one reload from the title.
const ready = (page, timeout = 60_000) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout });
const watch = (page) => {
  const errors = [], navs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('load', () => navs.push(page.url()));
  return { errors, navs };
};

test('Free Drive and the Sandbox: a chunk that fails once loads on the next press', async ({ page }) => {
  const seen = watch(page);
  const fail = { drive: true, sandbox: true }, asked = { drive: 0, sandbox: 0 };
  await page.route(/\/assets\/(drive|sandbox)-[\w-]+\.js(\?|$)/, (route, req) => {
    const k = /\/drive-/.test(req.url()) ? 'drive' : 'sandbox';
    asked[k]++;
    return fail[k] ? route.abort('connectionreset') : route.continue();
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  const cue = page.locator('[data-cue]');
  await page.locator('[data-drive-open]').click();
  await expect(cue).toHaveText(/Free Drive couldn’t load/, { timeout: 15_000 });
  fail.drive = false;
  const before = asked.drive;
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('.fd-card').first()).toBeVisible({ timeout: 20_000 });
  expect(asked.drive).toBeGreaterThan(before);   // the retry really fetched the chunk again
  await page.locator('[data-fd-back]').click();
  await expect(page.locator('[data-drive-picker]')).toBeHidden();
  await page.locator('[data-sandbox-open]').click();
  await expect.poll(() => page.evaluate(() => window.__coldgas.obs.snapshot().errors.filter((e) => e.kind === 'lazy').reduce((a, e) => a + e.n, 0)), { timeout: 15_000 }).toBe(2);
  expect(await page.evaluate(() => !!window.__coldgas.sandbox?.active)).toBe(false);
  fail.sandbox = false;
  await page.locator('[data-sandbox-open]').click();
  await page.waitForFunction(() => window.__coldgas.sandbox?.active, null, { timeout: 60_000 });
  expect(seen.navs).toHaveLength(1);   // the same build answered: no reload
  expect(seen.errors).toEqual([]);
});

// A Chromium that remembers the failed shared chunk (1243) needs the reload; one that asks again (1248) opens
// Free Drive on the retry. Either way: it opens, with at most one reload and no loop.
test("a shared chunk that fails once: the retry opens Free Drive, or the title reloads once and it opens", async ({ page }) => {
  test.slow();   // may boot the game twice on software GL
  const seen = watch(page);
  let fail = true;
  await page.route(/\/assets\/layer-[\w-]+\.js(\?|$)/, (route) => (fail ? route.abort('connectionreset') : route.continue()));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('[data-cue]')).toHaveText(/Free Drive couldn’t load/, { timeout: 15_000 });
  fail = false;
  await page.locator('[data-drive-open]').click();
  const card = page.locator('.fd-card').first();
  await expect.poll(async () => seen.navs.length > 1 || await card.isVisible(), { timeout: 20_000 }).toBe(true);
  if (seen.navs.length > 1) {
    await ready(page);
    await page.locator('[data-drive-open]').click();
  }
  await expect(card).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(seen.navs.length).toBeLessThanOrEqual(2);   // one reload at most, no loop
  expect(seen.errors).toEqual([]);
});

test("the judges' chunk fails once: the next run's judges load it", async ({ page }) => {
  let fail = true, asked = 0;
  await page.route(/\/assets\/theatre-[\w-]+\.js(\?|$)/, (route) => { asked++; return fail ? route.abort('connectionreset') : route.continue(); });
  await page.route(/\/api\/judge\/stream$/, (route) => route.abort());
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__coldgas.S.callMeta?.local === 'chunk' || window.__coldgas.S.callMeta?.local === 'stale', null, { timeout: 40_000 });
  fail = false;
  const before = asked;
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await expect.poll(() => page.evaluate(() => window.__coldgas.judgesReady()), { timeout: 30_000 }).toBe(true);
  expect(asked).toBeGreaterThan(before);
});

// The chunk spent ~27 of the judges' 35 s (leaving the chunk time to finish on a slow runner); the provider's answer
// is late for the ~8 s left, under the 30 s that count as the provider's own. That deadline is the
// network's, not the judges': the breaker that turns the AI panel off (persisted) doesn't count it.
test("the judges' chunk stalls 27 s and the provider answers late: the judge breaker doesn't count it", async ({ page }) => {
  test.slow();   // the judges' 35 s in real time
  let release = null;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/assets\/theatre-[\w-]+\.js(\?|$)/, async (route) => { await held; await route.continue().catch(() => {}); });
  await page.route(/\/api\/judge\/stream$/, () => { /* the provider: answers after the deadline */ });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__coldgas.obs.breaker('judge').snapshot().fails)).toBe(0);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await page.waitForTimeout(27_000);
  release();
  await page.waitForFunction(() => window.__coldgas.S.words?.source === 'local', null, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__coldgas.S.callMeta?.error || ''), { timeout: 5000 }).toMatch(/too long/);
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => window.__coldgas.obs.breaker('judge').snapshot());
  expect(b.fails).toBe(0);
  expect(b.state).toBe('closed');
});
