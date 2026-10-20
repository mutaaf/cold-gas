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
  // The judges' theatre runs the call (here the preview server has no API, so it falls back to
  // the local lines), then the words land and the receipt says what happened.
  await expect(page.locator('[data-judge="engineer"] .quote')).not.toBeEmpty({ timeout: 20_000 });
  await expect(page.locator('[data-receipt]')).toBeVisible();
  await expect(page.locator('[data-receipt]')).toContainText('local lines');
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

test('the judges\' brain: pick a provider, the key never leaves without Connect', async ({ page }) => {
  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.url()); });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-ai-open]')).toContainText('AI');
  await page.locator('[data-ai-open]').click();
  await expect(page.locator('#ai-title')).toBeVisible();
  await page.locator('[data-prov="openai"]').click();
  await page.locator('[data-key]').fill('sk-test-not-a-real-key');
  await expect(page.locator('[data-save]')).toBeDisabled();
  expect(calls).toEqual([]);
  await page.locator('[data-close]').click();
  await expect(page.locator('[data-ai-modal]')).toBeHidden();
});

test('ghost: after the reveal, the next jump flies with a ghost that G toggles', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await page.locator('[data-reveal]').click();
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 20_000 });

  await page.locator('[data-again]').click();
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__coldgas.S.run.tick > 120, null, { timeout: 30_000 });
  await page.keyboard.up('ArrowUp');
  // Visible, and posed from the stored run's frame for the live tick (lockstep).
  await page.waitForFunction(() => window.__coldgas.ghostRoot.visible, null, { timeout: 5_000 });
  const { want, got } = await page.evaluate(() => {
    const { S, ghostRoot } = window.__coldgas;
    const g = S.ghost, f = Math.min(g.n - 1, S.run.tick / 4 - 1), i = Math.floor(f), k = f - i;
    const a = i * g.stride, b = Math.min(g.n - 1, i + 1) * g.stride;
    return { want: g.data[a + 2] + (g.data[b + 2] - g.data[a + 2]) * k, got: ghostRoot.position.z };
  });
  expect(Math.abs(got - want)).toBeLessThan(1e-3);

  await page.keyboard.press('g');
  await page.waitForFunction(() => !window.__coldgas.ghostRoot.visible, null, { timeout: 5_000 });
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('coldgas_ghost'))).toBe('0');

  // The setting and the stored best both survive a reload.
  await page.goto('/coldgas/?play=jump&gfx=low');
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForFunction(() => window.__coldgas?.S.ghost?.n > 0, null, { timeout: 10_000 });
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__coldgas.ghostRoot.visible, null, { timeout: 5_000 });
});

test('ghost on a phone: the toggle fits the top bar and taps on and off', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto('/coldgas/?gfx=low');
  await page.locator('[data-assist]').tap();   // Pro: the widest the top bar gets
  for (const sel of ['[data-ai-open]', '[data-assist]', '[data-ghost]', '[data-mute]']) await expect(page.locator(sel)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('[data-ghost]').tap();
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-ghost]').tap();
  await expect(page.locator('[data-ghost]')).toHaveAttribute('aria-pressed', 'true');
  await page.close();
});
