import { test, expect } from '@playwright/test';

// The layout floor at the edges of what we ship to (tickets 0033, 0047): the landscape phone's top
// bar and mission block, a 320 px Slide Over column, the iPad title, the desktop keyboard hints,
// and fields that don't make iOS zoom. scripts/hud-audit.mjs and scripts/title-audit.mjs measure
// the whole matrix on screenshots; these are the cheap guards that run on every PR.
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const boot = async (page, q = '') => {
  await page.goto(`/coldgas/?gfx=low${q}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
};
const rect = (page, sel) => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}, sel);
const apart = (a, b) => a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1;

test('phone landscape: the mission block sits clear of Home and Retry during the Show', async ({ browser }) => {
  test.slow();   // waits on the title's software-GL frames before the run starts
  const page = await browser.newPage(touch(844, 390));
  await boot(page);
  await page.evaluate(async () => { await window.__coldgas.physicsReady; window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  await expect(page.locator('.quick-home')).toBeVisible();
  await expect(page.locator('.tier-chip')).toBeHidden();   // title settings step aside mid-run
  const mission = await rect(page, '[data-hud-box="mission"]'), actions = await rect(page, '.top-actions');
  expect(apart(mission, actions), JSON.stringify({ mission, actions })).toBe(true);
  for (const box of [mission, actions]) expect(box.r).toBeLessThanOrEqual(844);
  await page.close();
});

test('320 px column: the top bar and the title fit, nothing under the bar', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(touch(320, 568));
  await boot(page);
  await page.waitForTimeout(1300);   // the title's rise-in
  const actions = await rect(page, '.top-actions'), wordmark = await rect(page, '.wordmark'), cta = await rect(page, '[data-start]');
  expect(actions.x).toBeGreaterThanOrEqual(0);
  expect(actions.r).toBeLessThanOrEqual(320);
  expect(apart(actions, wordmark), JSON.stringify({ actions, wordmark })).toBe(true);
  expect(cta.b).toBeLessThanOrEqual(568);
  await page.close();
});

test('iPad title: the spec labels are 11 px or more', async ({ browser }) => {
  const page = await browser.newPage(touch(1024, 1366));
  await boot(page);
  await expect(page.locator('.spec')).toBeVisible();
  const sizes = await page.$$eval('.spec dt', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11);
  await page.close();
});

test('desktop: the Home and Retry key hints are 11 px or more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, '&play=jump');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown' || window.__coldgas?.S.mode === 'live', null, { timeout: 60_000 });
  const sizes = await page.$$eval('.quick kbd', (els) => els.filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBe(2);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11);
});

test('touch: every field is 16 px or more (iOS zooms into anything smaller) and taps do not flash', async ({ browser }) => {
  const page = await browser.newPage(touch(390, 844));
  await boot(page);
  const r = await page.evaluate(() => {
    // The lazily built sheets (AI key, Sandbox save, quest wish, endless seed) style their fields
    // with selectors like these; the same global floor has to win over them.
    const host = document.createElement('div');
    host.className = 'ai-field';
    host.innerHTML = '<input type="text"><select><option>a</option></select><textarea></textarea>';
    document.body.append(host);
    const sizes = [...document.querySelectorAll('input, select, textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize));
    const tap = getComputedStyle(document.querySelector('[data-start]')).webkitTapHighlightColor;
    host.remove();
    return { sizes, tap };
  });
  expect(r.sizes.length).toBeGreaterThan(3);
  for (const px of r.sizes) expect(px).toBeGreaterThanOrEqual(16);
  expect(r.tap).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await page.close();
});

test('first paint: the mono face is preloaded with the display and text faces', async ({ page }) => {
  const res = await page.goto('/coldgas/?gfx=low');
  const html = await res.text();
  expect(html).toMatch(/<link rel="preload" href="\/coldgas\/assets\/geist-mono-latin-400-normal-[\w-]+\.woff2" as="font"/);
  expect(html).toMatch(/michroma-latin-400-normal/);
});
