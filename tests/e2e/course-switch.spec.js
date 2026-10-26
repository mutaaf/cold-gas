import { test, expect } from '@playwright/test';

// 0046: a course click is a swap, never a build, a bake or a shader compile on the click's frame; and
// leaving Free Drive or the Sandbox gives the stage back its own clip planes (0.3 / 3000 m), so the
// slab's paint doesn't z-fight for the rest of the session.
const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }), n);

test('@heavy switching course compiles no new shader once the stage has warmed the other looks', async ({ page }) => {
  // The warm-up waits for the backdrop and for idle time, then builds, bakes and compiles two courses: on CI's
  // software GL that runs past a minute, so it gets the slow test's whole budget (@heavy: the flake guard runs it 2×).
  test.slow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage?.warm);
  await page.evaluate(() => window.__coldgas.stage.warm.then(() => true));
  await frames(page);
  const programs = () => page.evaluate(() => window.__coldgas.stage.renderer.info.programs.length);
  const before = await programs();
  for (const id of ['wall', 'lineup', 'show', 'lineup']) {
    await page.locator(`.course-btn[data-course="${id}"]`).click();
    await frames(page, 3);
    expect(await page.evaluate(() => window.__coldgas.stage.course)).toBe(id);
    expect(await programs(), `programs after switching to ${id}`).toBe(before);
  }
  expect(errors).toEqual([]);
});

test('@heavy Free Drive and the Sandbox hand the camera back with the stage\'s near and far planes', async ({ page }) => {
  test.slow();   // two worlds built and compiled on software GL
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.stage && window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  const planes = () => page.evaluate(() => { const c = window.__coldgas.camera; return [c.near, c.far]; });
  const stagePlanes = await planes();
  expect(stagePlanes).toEqual([0.3, 3000]);

  await page.evaluate(() => window.__coldgas.loadSandbox().then((s) => s.start()));
  await page.waitForFunction(() => window.__coldgas.sandbox?.active, null, { timeout: 90_000 });
  expect((await planes())[0]).not.toBe(0.1);
  await page.evaluate(() => window.__coldgas.sandbox.exit());
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  expect(await planes()).toEqual(stagePlanes);

  await page.locator('[data-drive-open]').click();
  await page.locator('.fd-card[data-road="stelvio"]').click();
  await page.locator('[data-fd-go]').click();
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  expect(await planes()).toEqual([0.5, 46000]);
  await page.evaluate(() => window.__coldgas.drive.exit());
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
  expect(await planes()).toEqual(stagePlanes);
});
