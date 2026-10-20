import { test, expect } from '@playwright/test';

// Free Drive: pick a real road on the title, drive it, and talk to nobody but our own origin.
// Building the road world and compiling its shaders on a CI runner's software GL takes a while,
// and every frame is slow there, so these get test.slow(); nothing in them is optional.
const watch = (page) => {
  const errors = [], foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) foreign.push(r.url()); });
  return { errors, foreign };
};

test('Free Drive: pick Stelvio on the title, the car drives up the real road', async ({ page }) => {
  test.slow();
  const seen = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('.fd-card')).toHaveCount(4);
  await expect(page.locator('.fd-card[data-road="stelvio"]')).toContainText('Stelvio Pass');
  await expect(page.locator('.fd-credit')).toContainText('OpenStreetMap contributors');
  await page.locator('.fd-card[data-road="stelvio"]').click();
  await page.locator('[data-fd-go]').click();
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  await expect(page.locator('[data-drive-hud]')).toBeVisible();
  await expect(page.locator('.fd-road-name')).toHaveText('Stelvio Pass');
  await expect(page.locator('.fd-fine')).toContainText('OpenStreetMap contributors');
  // Drive with the keyboard: throttle moves the car along the road.
  const s0 = await page.evaluate(() => window.__coldgas.drive.stats().i);
  // The key reaches the sim; then step the sim in 0.1 s frames (CI's software GL renders a few
  // frames a second under parallel load, so waiting on wall-clock time is a flake).
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__coldgas.drive.car.vel && Math.hypot(window.__coldgas.drive.car.vel.x, window.__coldgas.drive.car.vel.z) > 0.2, null, { timeout: 60_000 });
  for (let k = 0; k < 20; k++) {
    if (await page.evaluate((s0) => window.__coldgas.drive.stats().i > s0 + 3, s0)) break;
    await page.evaluate(() => { const d = window.__coldgas.drive; for (let n = 0; n < 10; n++) d.frame(0.1, performance.now() / 1000); });
  }
  expect(await page.evaluate(() => window.__coldgas.drive.stats().i)).toBeGreaterThan(s0 + 3);
  await page.keyboard.up('ArrowUp');
  // On the road, wheels down, not under it.
  const st = await page.evaluate(() => {
    const d = window.__coldgas.drive, c = d.car, r = d.road, i = d.stats().i;
    return { grounded: c.grounded, dy: c.pos.y - r.y[i], ele: Number(document.querySelector('[data-h-ele]').textContent.replace(/,/g, '')) };
  });
  expect(st.grounded).toBeGreaterThanOrEqual(3);
  expect(Math.abs(st.dy - 0.4)).toBeLessThan(0.7);
  expect(st.ele).toBeGreaterThan(1450);
  // R puts the car back on the road; Esc pauses; the title is one click away.
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drive-pause]')).toBeVisible();
  await page.locator('[data-dp-exit]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('Free Drive deep link on a phone: HUD, touch pedals and credits fit the screen', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const seen = watch(page);
  await page.goto('/coldgas/?drive=atlantic&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  for (const sel of ['.fd-road-name', '.fd-speed', '.fd-stats', '[data-h-reset]', '[data-h-exit]', '.fd-fine', '[data-btn-go]', '[data-btn-brake]', '[data-stick]']) {
    await expect(page.locator(sel)).toBeInViewport();
  }
  // The pedals drive the car (GO is the throttle).
  const s0 = await page.evaluate(() => window.__coldgas.drive.stats().i);
  const go = await page.locator('[data-btn-go]').boundingBox();
  await page.mouse.move(go.x + go.width / 2, go.y + go.height / 2);
  await page.mouse.down();
  await page.waitForFunction((s0) => window.__coldgas.drive.stats().i > s0 + 3, s0, { timeout: 60_000 });
  await page.mouse.up();
  // Controls don't sit on the pedals.
  const ctl = await page.locator('.fd-ctl').boundingBox(), btn = await page.locator('[data-btn-lift]').boundingBox();
  expect(ctl.y + ctl.height).toBeLessThan(btn.y);
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
  await page.close();
});
