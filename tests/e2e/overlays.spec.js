import { test, expect } from '@playwright/test';

// Restarting, jumping again or going to the title must clear everything the last run layered over
// the stage: the judges' theatre (mid-call), the results sheet, the pause sheet.
async function toResults(page) {
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'live' || window.__coldgas?.S.mode === 'countdown', null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await expect(page.locator('[data-theatre]')).toBeVisible({ timeout: 10_000 });
}

test('overlays close on Jump again, restart and title, even mid-theatre', async ({ page }) => {
  // Hold the judges' call open so the theatre is guaranteed to be mid-show.
  await page.route('**/coldgas/api/judge/stream', () => {});
  await page.goto('/coldgas/?play=reveal&gfx=low');
  await toResults(page);

  await page.evaluate(() => document.querySelector('[data-again]').click());
  await expect(page.locator('[data-theatre]')).toBeHidden();
  await expect(page.locator('[data-screen="results"]')).toBeHidden();
  await expect(page.locator('[data-screen="hud"]')).toBeVisible();

  await page.evaluate(() => window.__coldgas.startRun('reveal'));
  await toResults(page);
  await page.evaluate(() => { window.__coldgas.S.paused = true; document.querySelector('[data-restart]').click(); });
  await expect(page.locator('[data-theatre]')).toBeHidden();
  await expect(page.locator('[data-screen="pause"]')).toBeHidden();
  await expect(page.locator('[data-screen="results"]')).toBeHidden();

  await page.evaluate(() => window.__coldgas.startRun('reveal'));
  await toResults(page);
  await page.evaluate(() => window.__coldgas.toTitle());
  await expect(page.locator('[data-theatre]')).toBeHidden();
  await expect(page.locator('[data-screen="results"]')).toBeHidden();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  // A stale call finishing later must not resurrect anything.
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-theatre]')).toBeHidden();
});
