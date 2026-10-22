import { test, expect } from '@playwright/test';

// The endless road: pick it on the title with a seed, drive 2 km of a world built as you go, and
// talk to nobody but our own origin. CI's software GL renders a few frames a second, so the drive
// steps the sim in 0.1 s frames (the world streams from its worker meanwhile); test.slow() because
// building a world and compiling its shaders on that GL takes a while, not because anything waits
// on wall-clock time.
const watch = (page) => {
  const errors = [], foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol !== 'blob:') foreign.push(r.url()); });
  return { errors, foreign };
};

test('Endless: pick it with a seed, drive 2 km of generated road', async ({ page }) => {
  test.slow();
  const seen = watch(page);
  await page.goto('/coldgas/?gfx=low');
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('[data-road]')).toHaveCount(5);       // four real roads and Endless
  const card = page.locator('[data-road="endless"]');
  await expect(card).toContainText('Endless');
  await card.click();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-fd-seed]').fill('e2e-seed');
  await page.locator('[data-fd-go]').click();
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  await expect(page.locator('.fd-road-name')).toHaveText('Endless');
  await expect(page.locator('[data-h-share]')).toContainText('e2e-seed');
  // Drive it: the autopilot, the sim stepped in 0.1 s frames until 2 km are behind us.
  // Big batches: on CI's software GL every page render between them costs more than the sim.
  const s0 = await page.evaluate(() => { const d = window.__coldgas.drive; d.autopilot(true, { vmax: 50 }); return d.state.hint * 3; });
  for (let k = 0; k < 40; k++) {
    const done = await page.evaluate((s0) => {
      const d = window.__coldgas.drive;
      for (let n = 0; n < 80; n++) { d.frame(0.1, performance.now() / 1000); if (d.state.hint * 3 - s0 >= 2000) return true; }
      return false;
    }, s0);
    if (done) break;
  }
  const st = await page.evaluate(() => {
    const d = window.__coldgas.drive, c = d.car, s = d.stats(), w = d.world;
    const near = w.nearestRoad(c.pos.x, c.pos.z);
    return { km: (s.i * 3) / 1000, grounded: c.grounded, lat: Math.abs(near.lat) - near.hw, tiles: s.tiles, chunks: s.chunks, errors: s.worker.errors, built: s.worker.built, seed: d.seed };
  });
  expect(st.km * 1000 - s0).toBeGreaterThanOrEqual(2000);
  expect(st.grounded).toBeGreaterThanOrEqual(3);
  expect(st.lat).toBeLessThan(0);                 // on the ribbon
  expect(st.errors).toBe(0);
  expect(st.built).toBeGreaterThan(10);           // the worker built the land around us
  expect(st.chunks).toBeGreaterThan(3);
  expect(st.seed).toBe('e2e-seed');
  // The world API answers: ground under the car, and a ramp placed in front of it collides.
  const api = await page.evaluate(() => {
    const d = window.__coldgas.drive, w = d.world, c = d.car;
    const g = w.groundAt(c.pos.x, c.pos.z);
    const id = w.addObject({ type: 'ramp', x: c.pos.x, z: c.pos.z + 30, yaw: 0 });
    const out = {};
    const o = w.getObject(id);
    const phi = d.course.sdf(o.x, o.y + 0.3, o.z + 3, out);
    return { dy: c.pos.y - g.y, id, near: w.objectsNear({ x: o.x, z: o.z }, 5).length, phi, hit: !!out.object };
  });
  expect(api.dy).toBeGreaterThan(0.2);
  expect(api.dy).toBeLessThan(0.8);
  expect(api.id).toMatch(/^ramp\./);
  expect(api.near).toBe(1);
  expect(api.hit).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drive-pause]')).toBeVisible();
  await page.locator('[data-dp-exit]').click();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('Endless deep link on a phone: HUD and pedals fit, the GO pedal drives', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const seen = watch(page);
  await page.goto('/coldgas/?drive=endless&seed=phone&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 120_000 });
  for (const sel of ['.fd-road-name', '.fd-speed', '.fd-stats', '[data-h-reset]', '[data-h-exit]', '[data-btn-go]', '[data-btn-brake]', '[data-stick]']) {
    await expect(page.locator(sel)).toBeInViewport();
  }
  // The phone starts with the compact HUD (0061): the map comes out with MORE, and folds back.
  await page.locator('.fd-hud [data-hud-toggle]').tap();
  await expect(page.locator('.fd-map')).toBeInViewport();
  await page.locator('.fd-hud [data-hud-toggle]').tap();
  const s0 = await page.evaluate(() => window.__coldgas.drive.stats().i);
  const go = await page.locator('[data-btn-go]').boundingBox();
  await page.mouse.move(go.x + go.width / 2, go.y + go.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => { const v = window.__coldgas.drive.car.vel; return Math.hypot(v.x, v.z) > 0.2; }, null, { timeout: 60_000 });
  for (let k = 0; k < 20; k++) {
    if (await page.evaluate((s0) => window.__coldgas.drive.stats().i > s0 + 3, s0)) break;
    await page.evaluate(() => { const d = window.__coldgas.drive; for (let n = 0; n < 10; n++) d.frame(0.1, performance.now() / 1000); });
  }
  await page.mouse.up();
  expect(await page.evaluate(() => window.__coldgas.drive.stats().i)).toBeGreaterThan(s0 + 3);
  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]);
  await page.close();
});
