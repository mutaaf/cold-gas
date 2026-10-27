import { test, expect } from '@playwright/test';

// Focus in the modal sheets (0054, src/focus-trap.js): an open sheet takes focus, Tab and Shift+Tab never
// leave it (not to the HUD, the top bar or the sheet under it), and closing it hands focus back to the
// control that opened it.
const G = (page, fn, arg) => page.evaluate(fn, arg);
const inside = (page, sel) => G(page, (sel) => !!document.activeElement && document.querySelector(sel).contains(document.activeElement), sel);
const active = (page) => G(page, () => { const a = document.activeElement; return a ? `${a.tagName}${[...a.attributes].map((x) => `[${x.name}]`).join('')}` : 'none'; });

async function live(page) {
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await G(page, () => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
}

// Press Tab (or Shift+Tab) n times; after every press focus must be on a control inside `sel`.
async function tabsStayIn(page, sel, n, key = 'Tab') {
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    expect(await inside(page, sel), `${key} #${i + 1} left ${sel}: on ${await active(page)}`).toBe(true);
    seen.add(await active(page));
  }
  return seen;
}

test('1280×720 keyboard: Tab stays inside the pause sheet; Escape closes it and focus leaves with it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await live(page);
  await page.keyboard.press('Escape');
  const sheet = '[data-screen="pause"] .sheet';
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  // Focus went into the sheet as it opened (the dialog box itself, so no ring until the first Tab).
  expect(await inside(page, sheet)).toBe(true);
  const fwd = await tabsStayIn(page, sheet, 20);
  // It cycles through every action, not just one.
  expect(fwd.size).toBeGreaterThanOrEqual(5);
  await tabsStayIn(page, sheet, 7, 'Shift+Tab');
  // The first Tab from the box lands on Resume (actions first, 0092).
  await G(page, () => document.querySelector('[data-screen="pause"] .sheet').focus());
  await page.keyboard.press('Tab');
  expect(await G(page, () => document.activeElement.hasAttribute('data-resume'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="pause"]')).toBeHidden();
  expect(await G(page, () => window.__coldgas.S.paused)).toBe(false);
  // Focus didn't stay on a hidden button (Space and the arrows are the car's again).
  expect(await inside(page, sheet)).toBe(false);
});

test('1280×720 keyboard: Controls over the pause sheet holds Tab, Escape closes only it, focus returns to Controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await live(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.locator('[data-screen="pause"] [data-controls-open]').focus();
  await page.keyboard.press('Enter');
  const ctl = '[data-screen="controls"] .sheet';
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  expect(await inside(page, ctl)).toBe(true);
  await tabsStayIn(page, ctl, 20);
  await tabsStayIn(page, ctl, 5, 'Shift+Tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="controls"]')).toBeHidden();
  // The pause sheet is still up (Escape closed the sheet on top), and focus is back on its opener.
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  expect(await G(page, () => window.__coldgas.S.paused)).toBe(true);
  expect(await G(page, () => document.activeElement.matches('[data-screen="pause"] [data-controls-open]'))).toBe(true);
  // Done by keyboard does the same.
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await page.locator('[data-controls-close]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="controls"]')).toBeHidden();
  expect(await G(page, () => document.activeElement.matches('[data-screen="pause"] [data-controls-open]'))).toBe(true);
  // By mouse, a clicked button keeps no focus (src/input.js): Done hands focus to the pause sheet's box,
  // not back to Controls, where a Space or an Enter would click it again.
  await page.locator('[data-screen="pause"] [data-controls-open]').click();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await page.locator('[data-controls-close]').click();
  await expect(page.locator('[data-screen="controls"]')).toBeHidden();
  expect(await G(page, () => document.activeElement.matches('[data-screen="pause"] [role="dialog"]'))).toBe(true);
  // P resumes from under Controls, and Controls goes with the pause sheet.
  await page.locator('[data-screen="pause"] [data-controls-open]').click();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  await page.keyboard.press('KeyP');
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
  await expect(page.locator('[data-screen="controls"]')).toBeHidden();
});

test('1280×720: the board holds Tab and Escape gives focus back to the title link that opened it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/coldgas/api/scores**', (r) => r.fulfill({ json: { rows: [] } }));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S?.mode === 'title', null, { timeout: 60_000 });
  const link = page.locator('[data-screen="title"] [data-board-open]');
  await link.focus();
  await page.keyboard.press('Enter');
  const board = '[data-screen="board"] .sheet';
  await expect(page.locator('[data-screen="board"]')).toBeVisible();
  await tabsStayIn(page, board, 12);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="board"]')).toBeHidden();
  expect(await G(page, () => document.activeElement.matches('[data-screen="title"] [data-board-open]'))).toBe(true);
});

test('390×844 touch: the pause sheet takes focus without a ring, and a tap on Resume resumes', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await live(page);
  // A phone pauses the way it does when it rings: the tab goes hidden and comes back.
  await G(page, () => {
    const set = (v) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
    set(true); set(false);
  });
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  const sheet = '[data-screen="pause"] .sheet';
  expect(await inside(page, sheet)).toBe(true);
  // The box holds focus, not a button: no focus ring on a phone.
  expect(await G(page, () => document.activeElement.matches('[role="dialog"]') && getComputedStyle(document.activeElement).outlineStyle)).toBe('none');
  await page.locator('[data-resume]').tap();
  await expect.poll(() => G(page, () => window.__coldgas.S.paused)).toBe(false);
  expect(await inside(page, sheet)).toBe(false);
  await ctx.close();
});
