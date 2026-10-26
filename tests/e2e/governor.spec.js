import { test, expect } from '@playwright/test';

// The resolution governor (src/obs/ledger.js createGovernor → src/render/scene.js setPixelScale, 0044):
// a step mid-run never presents a black frame, and the drawing buffer follows the device's pixel ratio
// when it changes (another monitor, browser zoom).
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });

// Takes one forced governor step exactly where the governor takes it (obs.frame, at the end of a frame
// that has already drawn) and reads the canvas back in the same task: what the browser presents for
// that frame. Then the next frame, drawn at the new resolution.
async function stepMidRun(page, scale) {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  // The real governor steps on software GL (fold.spec, hud-collapse.spec): off, so only the forced step happens.
  await page.evaluate(() => { window.__coldgas.obs.governor = null; window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await expect.poll(() => page.evaluate(() => window.__coldgas.S.mode)).toBe('live');
  const f0 = await page.evaluate(() => window.__coldgas.stage.renderer.info.render.frame);
  await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.info.render.frame), { timeout: 30_000 }).toBeGreaterThan(f0 + 2);
  return page.evaluate((k) => new Promise((resolve) => {
    const { stage, obs, S } = window.__coldgas;
    const c = stage.renderer.domElement;
    const probe = document.createElement('canvas');
    probe.width = 64; probe.height = 36;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    const luma = () => {
      ctx.clearRect(0, 0, 64, 36);
      ctx.drawImage(c, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    };
    const base = Math.min(devicePixelRatio, 1);   // ?gfx=low's cap
    // Registered from a task, this callback runs after the game's (registered by its previous frame).
    requestAnimationFrame(() => {
      const before = luma();
      obs.onScale(k);              // what the governor does at the end of a frame
      const presented = luma();    // nothing draws between here and the browser presenting the frame
      requestAnimationFrame(() => resolve({ before, presented, next: luma(), base, pr1: stage.renderer.getPixelRatio(), mode: S.mode, w: c.width }));
    });
  }), scale);
}

test('a forced resolution step mid-run never presents a black frame (1280x720)', async ({ page }) => {
  const r = await stepMidRun(page, 0.55);
  expect(r.mode).toBe('live');
  expect(r.before).toBeGreaterThan(3);                     // the stage is lit, so black would show
  expect(r.presented).toBeGreaterThan(r.before * 0.8);     // the frame the browser shows is the drawn one
  expect(r.next).toBeGreaterThan(r.before * 0.5);          // and the next, at the new resolution, draws too
  expect(r.pr1).toBeCloseTo(Math.max(0.5, r.base * 0.55), 5);
  expect(r.w).toBe(Math.floor(1280 * r.pr1));
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test('a forced resolution step mid-run never presents a black frame (390x844 touch)', async ({ page }) => {
    const r = await stepMidRun(page, 0.7);
    expect(r.mode).toBe('live');
    expect(r.before).toBeGreaterThan(3);
    expect(r.presented).toBeGreaterThan(r.before * 0.8);
    expect(r.next).toBeGreaterThan(r.before * 0.5);
    expect(r.pr1).toBeCloseTo(Math.max(0.5, r.base * 0.7), 5);
  });
});

test('the drawing buffer follows a change of device pixel ratio (another monitor, zoom)', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page.goto('/coldgas/?gfx=mid');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.obs.governor = null; window.__coldgas.obs.onScale(1); });
  await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio())).toBe(1);
  // Dragged to a 2× display: the ratio follows (capped at 1.5 on mid), and the canvas keeps drawing.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
  await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio()), { timeout: 30_000 }).toBe(1.5);
  await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.domElement.width), { timeout: 30_000 }).toBe(1920);
  // A governor step multiplies the new ratio, not the boot one.
  await page.evaluate(() => window.__coldgas.obs.onScale(0.7));
  await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio()), { timeout: 30_000 }).toBeCloseTo(1.05, 5);
});
