import { test, expect } from '@playwright/test';

// Layout at the viewports the HUD audit found broken (0033): phones and iPads lying down (the
// mission clock under Home and Retry), Slide Over at 320 px (the top bar off screen), a notch's
// safe-area insets, and the desktop's key caps. scripts/hud-audit.mjs measures the rest.
// physicsReady is a function (docs/LESSONS.md): wait on it, or startRun defers and skipCountdown does nothing.
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage && window.__coldgas.physicsReady(), null, { timeout: 30_000 });
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });
const SAFE_LANDSCAPE = ':root { --safe-t: 0px !important; --safe-r: 47px !important; --safe-b: 21px !important; --safe-l: 47px !important; }';
const rect = (page, sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
const apart = (a, b) => a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;

async function showRun(page) {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  await expect(page.locator('[data-hud-box=mission]')).toBeVisible();
}

for (const [w, h, safe] of [[844, 390], [1024, 768], [844, 390, SAFE_LANDSCAPE]]) {
  test(`${w}x${h}${safe ? ' with notch insets' : ''}: the mission clock clears Home and Retry, the top bar fits`, async ({ browser }) => {
    const page = await browser.newPage(touch(w, h));
    if (safe) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }), safe);
    await showRun(page);
    const mission = await rect(page, '[data-hud-box=mission]');
    const actions = await rect(page, '.top-actions');
    expect(apart(mission, actions), `mission ${JSON.stringify(mission)} × top-actions ${JSON.stringify(actions)}`).toBe(true);
    // The title-screen chips step aside mid-run; Home and Retry stay.
    await expect(page.locator('.ai-chip')).toBeHidden();
    await expect(page.locator('.tier-chip')).toBeHidden();
    await expect(page.locator('.quick-retry')).toBeInViewport({ ratio: 1 });
    // Nothing in the top bar under the notch.
    if (safe) expect(actions.r).toBeLessThanOrEqual(w - 47);
    await page.close();
  });
}

test('844x390 on the Lineup: the attitude dial clears the LIFT button', async ({ browser }) => {
  const page = await browser.newPage(touch(844, 390));
  await page.goto('/coldgas/?course=lineup&gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  const lift = page.locator('.tbtn.lift');
  await expect(lift).toBeVisible();   // slot C on the Lineup's run-up
  const att = await rect(page, '[data-hud-box=att]');
  expect(apart(att, await rect(page, '.tbtn.lift')), `attitude ${JSON.stringify(att)}`).toBe(true);
  await page.close();
});

test('320x568 (Slide Over): the top bar and the wordmark fit on the title', async ({ browser }) => {
  const page = await browser.newPage(touch(320, 568));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.waitForTimeout(1500);   // the title rises in
  for (const el of await page.locator('.top-actions > *').all()) if (await el.isVisible()) await expect(el).toBeInViewport({ ratio: 1 });
  const word = await rect(page, '.wordmark');
  expect(word.y).toBeGreaterThanOrEqual(0);
  expect(apart(word, await rect(page, '.top-actions'))).toBe(true);
  await expect(page.locator('.cta [data-start]')).toBeInViewport({ ratio: 1 });
  await page.close();
});

test('1280x720: the H and R key caps are at least 11 px', async ({ page }) => {
  await showRun(page);
  for (const kbd of await page.locator('.quick kbd').all()) {
    await expect(kbd).toBeVisible();
    expect(parseFloat(await kbd.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
  }
});
