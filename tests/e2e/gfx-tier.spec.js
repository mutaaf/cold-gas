import { test, expect, devices } from '@playwright/test';

// 0037: an iPhone or iPad (Safari caps hardwareConcurrency, has no deviceMemory) boots 'mid', with
// edge anti-aliasing after the output pass, and obs labels an iPad a tablet.
const ready = (page) => page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 30_000 });
const fourCores = () => {
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => undefined, configurable: true });
};

for (const [name, dev, kind] of [['iPhone', devices['iPhone 13'], 'phone'], ['iPad', devices['iPad Pro 11'], 'tablet']]) {
  test(`an ${name} with 4 cores boots mid with anti-aliasing`, async ({ browser }) => {
    const { defaultBrowserType, ...opts } = dev;
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    // A fresh device: no ledger history to move the tier.
    await page.addInitScript(fourCores);
    await page.goto('/coldgas/');
    await ready(page);
    await page.evaluate(() => window.__coldgas.stage.ready);
    const got = await page.evaluate(() => ({
      cores: navigator.hardwareConcurrency, tier: window.__coldgas.obs.tier, dc: window.__coldgas.obs.deviceClass,
      aa: !!window.__coldgas.stage.aa, msaa: window.__coldgas.stage.renderer.getContextAttributes().antialias,
    }));
    expect(got.cores).toBe(4);
    expect(got.tier).toBe('mid');
    expect(got.dc).toMatch(new RegExp(`^${kind}-`));
    expect(got.aa).toBe(true);        // the edge pass after the OutputPass
    expect(got.msaa).toBe(false);     // canvas MSAA only where the scene draws to the canvas ('low')
    // The beacon keeps to the Worker's classes until it learns 'tablet'.
    expect((await page.evaluate(() => window.__coldgas.obs.payload())).dc).toMatch(/^(phone|desktop)-/);
    await ctx.close();
  });
}

test('the low tier draws to an antialiased canvas', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__coldgas.stage.renderer.getContextAttributes().antialias)).toBe(true);
});
