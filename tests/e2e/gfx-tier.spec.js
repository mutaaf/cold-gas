import { test, expect, devices } from '@playwright/test';

// 0037 → 0097: an iPhone or iPad (Safari caps hardwareConcurrency, has no deviceMemory) boots 'high', the
// desktop's look (shadows 2048, the film look, the pixel-ratio cap of 2), with edge anti-aliasing after the
// output pass, and obs labels an iPad a tablet.
const ready = (page) => page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 60_000 });
const fourCores = () => {
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => undefined, configurable: true });
};

for (const [name, dev, kind] of [['iPhone', devices['iPhone 13'], 'phone'], ['iPad', devices['iPad Pro 11'], 'tablet']]) {
  test(`an ${name} with 4 cores boots high, the desktop look, with anti-aliasing`, async ({ browser }) => {
    const { defaultBrowserType, ...opts } = dev;
    // The tier reads the user agent, touch and cores, not the pixel ratio: draw at 1× so software GL
    // is not filling an iPad Pro's 1668×2388 through the high tier's passes (a boot past 60 s on CI).
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // A fresh device: no ledger history to move the tier.
    await page.addInitScript(fourCores);
    await page.goto('/coldgas/');
    await ready(page);
    await page.evaluate(() => window.__coldgas.stage.ready);
    // The edge pass is its own small chunk; the film look (a lazy chunk after the backdrop) follows from the tier
    // in scene.js and is shown by docs/shots/0097, so the test doesn't wait for it on software GL (CI's e2e 1/3
    // shard has no minute to spare).
    await expect.poll(() => page.evaluate(() => !!window.__coldgas.stage.aa), { timeout: 30_000 }).toBe(true);
    const got = await page.evaluate(() => ({
      cores: navigator.hardwareConcurrency, tier: window.__coldgas.obs.tier, dc: window.__coldgas.obs.deviceClass,
      aa: !!window.__coldgas.stage.aa, aaKind: window.__coldgas.stage.aaKind, msaa: window.__coldgas.stage.renderer.getContextAttributes().antialias,
      shadow: window.__coldgas.stage.key.shadow.mapSize.x,
    }));
    expect(got.cores).toBe(4);
    expect(got.tier).toBe('high');
    expect(got.shadow).toBe(2048);    // the desktop's shadow map
    expect(got.dc).toMatch(new RegExp(`^${kind}-`));
    expect(got.aa).toBe(true);        // the edge pass after the OutputPass
    expect(got.aaKind).toBe('fxaa');  // the filter the phone flicker probe chose (0097); a desktop draws SMAA
    expect(got.msaa).toBe(false);     // canvas MSAA only where the scene draws to the canvas ('low')
    // The beacon keeps to the Worker's classes until it learns 'tablet'.
    expect((await page.evaluate(() => window.__coldgas.obs.payload())).dc).toMatch(/^(phone|desktop)-/);
    await ctx.close();
  });
}

test('the low tier draws to an antialiased canvas, except on a software rasterizer', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  // This suite runs on SwiftShader (playwright.config.js), where MSAA costs a third of the frame and
  // 'low' skips it (src/gfx-tier.js). A GPU gets it.
  const r = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { name: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '', aa: window.__coldgas.stage.renderer.getContextAttributes().antialias };
  });
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r.name);
  expect(r.aa).toBe(!software);
});
