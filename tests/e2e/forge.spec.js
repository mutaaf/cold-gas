import { test, expect } from '@playwright/test';

// The forge's models (0212): fetched from our own origin after the title is up, swapped into the parked row at the next
// cut (never under a still title or in a run); ?forge=0 keeps the procedural row and fetches nothing.
const forged = (page) => page.evaluate(() => {
  let n = 0, all = 0;
  window.__coldgas.stage.scene.traverse((o) => { if (o.userData?.forgeId) { all++; if (o.userData.forged) n++; } });
  return { n, all };
});

test('the forged row comes from our origin after the title, and lands at the next cut', async ({ page }) => {
  test.slow();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/404/.test(m.text())) errors.push(m.text()); });
  let titleUp = false;
  page.on('request', (r) => { if (r.url().includes('/forge/')) asked.push({ url: r.url(), afterTitle: titleUp }); });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeVisible();
  titleUp = true;
  await expect.poll(() => asked.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(5);
  for (const a of asked) {
    expect(new URL(a.url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(a.url).toMatch(/\/coldgas\/forge\/[a-z]+\.glb$/);
  }
  // Still procedural on a still title, however long it stands: the models land only at a cut.
  await page.waitForTimeout(1500);
  expect((await forged(page)).n).toBe(0);
  // The next cut (back to the title) after they've loaded swaps the row. Loading, parsing and warming their programs
  // (up to 4 s) can outlast any fixed wait on a slow runner, and a cut before they're ready swaps nothing, so cut on
  // every poll until one lands after them.
  await expect.poll(async () => {
    await page.evaluate(() => window.__coldgas.toTitle());
    return (await forged(page)).n;
  }, { timeout: 30_000, intervals: [1000] }).toBeGreaterThan(0);
  const { n, all } = await forged(page);
  expect(n).toBe(all);
  // A run over the forged row plays and judges as before (the sim is untouched: its colliders are the sim's own).
  await page.locator('[data-reveal]').click();
  await page.evaluate(() => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  await expect.poll(async () => Number(await page.locator('[data-r-total]').textContent())).toBeGreaterThan(70);
  expect(errors).toEqual([]);
});

test('?forge=0 keeps the procedural row and fetches no forged model', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (r.url().includes('/forge/')) asked.push(r.url()); });
  await page.goto('/coldgas/?gfx=low&forge=0');
  await expect(page.locator('[data-start]')).toBeVisible();
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.__coldgas.toTitle());
  expect(asked).toEqual([]);
  expect((await forged(page)).n).toBe(0);
});
