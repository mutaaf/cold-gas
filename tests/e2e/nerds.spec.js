import { test, expect } from '@playwright/test';

// For nerds: ` opens a live engineering readout that only reads (the engine's counters are wrapped
// while it is open and put back when it closes), and a run beside it replays to the same bits.
test('` opens the nerds panel, it counts the work live, and closing it restores the engine', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 30_000 });
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await page.keyboard.press('Backquote');
  const panel = page.locator('[data-nerds-root]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-nerds]')).toHaveAttribute('aria-pressed', 'true');
  // A second of counting: ticks and ray casts come up, the fingerprint is 8 hex digits at a tick.
  await expect(page.locator('[data-k="L.ticks"]')).not.toHaveText('—', { timeout: 15_000 });
  await expect(page.locator('[data-k="L.rays"]')).not.toHaveText('—');
  await expect(page.locator('[data-k="det.hash"]')).toHaveText(/^[0-9a-f]{8} @ \d+$/);
  await expect(page.locator('.nd-wheel')).toHaveCount(4);
  expect(await page.evaluate(() => window.__coldgas.S.run.car.world.rw.step.toString().includes('performance.now'))).toBe(true);
  await page.keyboard.press('Backquote');
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.__coldgas.S.run.car.world.rw.step.toString().includes('performance.now'))).toBe(false);
});
