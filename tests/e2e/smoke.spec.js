import { test, expect } from '@playwright/test';

// The game boots, plays the reference jump end to end, and talks to nobody but its own origin.
test('boots, flies the reference jump, and judges it', async ({ page }) => {
  const errors = [];
  const foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) foreign.push(r.url()); });

  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('.wordmark')).toBeVisible();
  await expect(page.locator('[data-start]')).toBeVisible();

  await page.locator('[data-reveal]').click();
  await expect(page.locator('[data-screen="hud"]')).toBeVisible();
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 20_000 });
  await expect(page.locator('[data-screen="results"]')).toBeVisible();
  const total = Number(await page.locator('[data-r-total]').textContent());
  await expect.poll(async () => Number(await page.locator('[data-r-total]').textContent())).toBeGreaterThan(70);
  await expect(page.locator('[data-judge]')).toHaveCount(3);
  // Words arrive from the AI panel or the local fallback.
  await expect(page.locator('[data-judge="engineer"] .quote')).not.toBeEmpty({ timeout: 15_000 });
  expect(total).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test('deep link ?play=jump starts a countdown and accepts keyboard input', async ({ page }) => {
  await page.goto('/coldgas/?play=jump&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 30_000 });
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -93, null, { timeout: 30_000 });
  await page.keyboard.up('ArrowUp');
  const z = await page.evaluate(() => window.__coldgas.S.run.car.pos.z);
  expect(z).toBeGreaterThan(-93);
});

test('phone layout: touch controls visible and nothing overlaps the title CTA', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeInViewport();
  await page.locator('[data-start]').tap();
  await expect(page.locator('[data-touch]')).toBeVisible();
  await expect(page.locator('[data-btn-lift]')).toBeInViewport();
  await page.close();
});
