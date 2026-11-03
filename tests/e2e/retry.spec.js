import { test, expect } from '@playwright/test';

// The loop after a run: Retry puts you back in control in about a second (one beat of READY, not a
// 3-2-1), Home is one key or tap away, and both stay reachable over the judges' theatre.
const mode = (page) => page.evaluate(() => window.__coldgas.S.mode);
async function toResults(page) {
  await page.evaluate(() => { window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
}

test('R retries with a one-second READY (not a 3-2-1), H goes home, and the run line counts runs', async ({ page }) => {
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre open
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await expect(page.locator('.quick-retry')).toBeVisible();
  await toResults(page);
  await expect(page.locator('[data-r-attempt]')).toHaveText('Run 1');

  await page.keyboard.press('KeyR');
  await expect(page.locator('[data-theatre]')).toBeHidden();
  // Game time, not wall time: software GL in CI renders slowly and the countdown runs on frames.
  expect(await page.evaluate(() => [window.__coldgas.S.mode, window.__coldgas.S.countLen])).toEqual(['countdown', 1]);
  await expect(page.locator('[data-count] .word')).toHaveText('Ready');
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });

  await toResults(page);
  await expect(page.locator('[data-r-attempt]')).toHaveText('Run 2');
  await page.keyboard.press('KeyH');
  expect(await mode(page)).toBe('title');
  await expect(page.locator('.quick-retry')).toBeHidden();
});

// On a phone the judges' call runs docked on the sheet (audit 2026-10-30): the score is never behind it, and
// "Watch the call" puts the theatre up, its bar carrying Retry and Home.
test('phone: Retry and Home are on the theatre and pinned under the results', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route('**/coldgas/api/judge/stream', () => {});
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.startRun('jump'));
  await toResults(page);
  await expect(page.locator('[data-theatre]')).toBeHidden();
  await expect(page.locator('[data-r-total]')).toBeVisible();
  await page.locator('[data-call-watch]').tap({ timeout: 60_000 });
  await page.locator('.th-quick [data-again]').tap();
  expect(await page.evaluate(() => window.__coldgas.S.countLen)).toBe(1);
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 15_000 });
  await toResults(page);
  await page.locator('[data-call-watch]').tap({ timeout: 60_000 });
  await page.locator('.th-quick [data-home]').tap();
  expect(await mode(page)).toBe('title');
  await ctx.close();
});
