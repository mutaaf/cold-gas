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

// 0097: a phone boots the desktop's look ('high', pixel-ratio cap 2). On a run it can't hold, the governor takes
// pixels, not the look: slow frames (45 ms intervals with 30 ms of CPU work, three 2 s windows) fed through the
// real path (obs.frame → createGovernor → obs.onScale → stage.setPixelScale) step the drawing buffer down to
// 85 % and then 70 % of the device ratio, and the tier and the shadows stay.
test.describe('phone at the high look', () => {
  // 1× on software GL: the high tier's passes at 780×1688 cost CI's e2e 1/3 shard a minute it doesn't have; the
  // steps are ratios of whatever the device's pixel ratio is (the 2× cap: tests/unit/gfx-tier.test.js, docs/shots/0097).
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  test('a run that keeps missing its frames steps the resolution down and keeps the look', async ({ page }) => {
    await page.goto('/coldgas/');
    await ready(page);
    const boot = await page.evaluate(() => ({ tier: window.__coldgas.obs.tier, shadow: window.__coldgas.stage.key.shadow.mapSize.x, gov: !!window.__coldgas.obs.governor }));
    expect(boot).toEqual({ tier: 'high', shadow: 2048, gov: true });
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    await expect.poll(() => page.evaluate(() => window.__coldgas.S.mode)).toBe('live');
    // Software GL is slow enough that the real governor may already have stepped on the title: start from full
    // resolution.
    await page.evaluate(() => { const { obs } = window.__coldgas; Object.assign(obs.governor, { level: 0, bad: 0, good: 0 }); obs.scale = 0; obs.onScale(1); });
    await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio()), { timeout: 30_000 }).toBe(1);
    // Synchronously, so no real frame lands inside the forced windows: 6.1 s of 45 ms frames = 3 windows = one step.
    // The forced clock runs ahead of the real one, so the real frames after it don't close a window of their own.
    const slow = (secs) => page.evaluate((secs) => {
      const { obs } = window.__coldgas;
      const t0 = Math.max(performance.now(), window.__gov0097 || 0) + 10_000;
      let t = t0;
      for (; t < t0 + secs * 1000; t += 45) obs.frame(t, 45, 4, 20, 30, 0);
      window.__gov0097 = t;
      return obs.scale;
    }, secs);
    const s1 = await slow(6.1);
    expect(s1).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio()), { timeout: 30_000 }).toBeLessThanOrEqual(0.85 + 1e-6);
    const s2 = await slow(6.1);
    expect(s2).toBeGreaterThan(s1);
    await expect.poll(() => page.evaluate(() => window.__coldgas.stage.renderer.getPixelRatio()), { timeout: 30_000 }).toBeLessThanOrEqual(0.7 + 1e-6);
    const after = await page.evaluate(() => ({ tier: window.__coldgas.obs.tier, shadow: window.__coldgas.stage.key.shadow.mapSize.x }));
    expect(after).toEqual({ tier: 'high', shadow: 2048 });
  });
});
