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
  // Any real movement proves the key reached the sim (software GL in CI can run at a few fps).
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -116, null, { timeout: 45_000 });
  await page.keyboard.up('ArrowUp');
  const z = await page.evaluate(() => window.__coldgas.S.run.car.pos.z);
  expect(z).toBeGreaterThan(-116);
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

test('bring your own key: paste one key and it is done', async ({ page }) => {
  const calls = [];
  await page.route('**/coldgas/api/models', async (route) => {
    const req = route.request();
    calls.push({ body: req.postDataJSON(), key: req.headers()['x-cg-key'] });
    await route.fulfill({ json: { provider: 'anthropic', models: ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'], suggested: 'claude-haiku-5-5' } });
  });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-ai-open]')).toHaveText('AI · Free');
  await page.locator('[data-ai-open]').click();
  await expect(page.locator('#ai-title')).toHaveText('Use your own AI');

  // A look-alike key is explained, and never sent anywhere.
  await page.locator('[data-key]').fill('gsk_' + 'x'.repeat(40));
  await expect(page.locator('[data-result]')).toContainText('Groq');
  expect(calls).toEqual([]);

  // A sloppy paste of a real-shaped key: detected, checked, chosen, saved. One action.
  await page.locator('[data-key]').fill('  "sk-ant-api03-' + 'k'.repeat(40) + '"  ');
  await expect(page.locator('[data-result]')).toContainText('Done', { timeout: 10_000 });
  await expect(page.locator('[data-result]')).toContainText('Claude Haiku 5.5');
  expect(calls).toHaveLength(1);
  expect(calls[0].body.provider).toBe('auto');
  expect(calls[0].key).toBe('sk-ant-api03-' + 'k'.repeat(40));
  await expect(page.locator('[data-ai-open]')).toHaveText('AI · Claude');

  // Back to free in one tap.
  await page.locator('[data-free]').click();
  await expect(page.locator('[data-ai-open]')).toHaveText('AI · Free');
  await page.locator('[data-done]').click();
  await expect(page.locator('[data-ai-modal]')).toBeHidden();
});

test('phone: GO pedal drives, the stick alone does not, and air pitch is not inverted', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto('/coldgas/?play=jump&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 30_000 });
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await expect(page.locator('[data-btn-go]')).toBeVisible();
  // Touching the stick without moving it must not drive the car.
  const stick = page.locator('[data-stick]');
  const box = await stick.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__coldgas.S.run.car.pos.z)).toBeLessThan(-94);
  // Holding GO does.
  const go = await page.locator('[data-btn-go]').boundingBox();
  await page.dispatchEvent('[data-btn-go]', 'pointerdown', { pointerId: 7, clientX: go.x + 10, clientY: go.y + 10 });
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -93, null, { timeout: 30_000 });
  await page.dispatchEvent('[data-btn-go]', 'pointerup', { pointerId: 7 });
  await page.close();
});

// Right means right: from the chase camera, pressing → turns the car to the right of the screen,
// and the default event is the Show (both stunts, one run).
test('keyboard: → steers right on screen, and the Show is the default event', async ({ page }) => {
  await page.goto('/coldgas/?play=jump&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__coldgas.S.run.course)).toBe('show');
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -116, null, { timeout: 45_000 });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__coldgas.S.run.car.vel.x < -0.4, null, { timeout: 45_000 });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowUp');
  // Project the car into the camera: it has moved right of centre on screen.
  const sx = await page.evaluate(() => {
    const { camera, carRoot } = window.__coldgas;
    const p = carRoot.position.clone().project(camera);
    return p.x;
  });
  const vx = await page.evaluate(() => window.__coldgas.S.run.car.vel.x);
  expect(vx).toBeLessThan(-0.3);        // world −x is the driver's right when heading +z
  expect(sx).toBeGreaterThan(-0.05);
});
