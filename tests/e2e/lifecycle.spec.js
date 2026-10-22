import { test, expect } from '@playwright/test';

// Runs and modes clean up after themselves (0039): every way out of a run gives the physics
// engine its world back, a Start asked for while the engine loads can't fire later into another
// mode, the title tears down Free Drive and the Sandbox, and a double tap opens one Sandbox.
// And the first Jump starts at once (0043): the reference ghost is flown on the title.
const G = (page, fn, arg) => page.evaluate(fn, arg);
const ready = (page) => page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
const ghostsReady = (page) => page.waitForFunction(() => ['show', 'wall', 'lineup'].every((c) => window.__coldgas.refGhostReady(c)), null, { timeout: 60_000 });

test('200 × (start → title, or retry mid-run) keeps the engine\'s memory flat', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await ghostsReady(page);   // the title's background flights are done (they free their worlds too)
  const mem = await G(page, () => {
    const g = window.__coldgas, out = [];
    for (let i = 0; i < 200; i++) {
      g.startRun('jump');
      if (i % 2) { g.skipCountdown(); g.startRun('jump', true); }   // a retry mid-run, then home
      g.toTitle();
      if (i === 0 || i === 199) out.push(g.physicsMemoryBytes());
    }
    return out;
  });
  console.log(`engine memory: first ${(mem[0] / 1048576).toFixed(1)} MB, after 200 ${(mem[1] / 1048576).toFixed(1)} MB`);
  expect(mem[1]).toBeLessThanOrEqual(mem[0] * 1.05);
});

test('a Start tapped while the engine loads, then Free Drive opened: no run starts', async ({ page }) => {
  // Hold the engine's WASM back so the taps land during its load.
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/*.wasm', async (route) => { await held; await route.continue(); });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeVisible();
  expect(await G(page, () => window.__coldgas.physicsReady())).toBe(false);
  await page.locator('[data-start]').click();
  await page.locator('[data-start]').click();   // and again: still one start at most
  await page.locator('[data-drive-open]').click();
  await expect(page.locator('[data-drive-picker]')).toBeVisible({ timeout: 30_000 });
  release();
  await ready(page);
  await page.waitForTimeout(1500);
  expect(await G(page, () => [window.__coldgas.S.mode, !!window.__coldgas.S.run])).toEqual(['title', false]);
});

test('several Starts tapped while the engine loads start exactly one run', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/*.wasm', async (route) => { await held; await route.continue(); });
  await page.goto('/coldgas/?gfx=low');
  await expect(page.locator('[data-start]')).toBeVisible();
  // Count the runs the page builds (every run starts on a fresh countdown).
  await G(page, () => { window.__starts = 0; new MutationObserver(() => { if (document.body.dataset.mode === 'countdown') window.__starts++; }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] }); });
  for (let i = 0; i < 3; i++) await page.locator('[data-start]').click();
  release();
  await ready(page);
  await page.waitForFunction(() => window.__coldgas.S.mode === 'countdown', null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  expect(await G(page, () => window.__starts)).toBe(1);
});

test('the title tears down Free Drive (as heal\'s escalation does): no driving chrome is left', async ({ page }) => {
  test.slow();   // a real road loads and its world builds on software GL
  await page.goto('/coldgas/?drive=atlantic&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
  await expect(page.locator('body')).toHaveClass(/driving/);
  await G(page, () => window.__coldgas.toTitle());
  await expect(page.locator('body')).not.toHaveClass(/driving/);
  expect(await G(page, () => ({ mode: window.__coldgas.S.mode, active: window.__coldgas.drive.active, far: window.__coldgas.camera.far }))).toEqual({ mode: 'title', active: false, far: 4000 });
  await expect(page.locator('[data-drive-hud]')).toBeHidden();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
});

test('a double tap on Sandbox builds one arena, and the title takes it down', async ({ page }) => {
  test.slow();   // the arena builds and compiles on software GL
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('[data-sandbox-open]').dblclick();
  await page.waitForFunction(() => window.__coldgas.sandbox?.active, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('.sb-hud')).toHaveCount(1);
  await G(page, () => window.__coldgas.toTitle());
  await expect(page.locator('.sb-hud')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/driving/);
  expect(await G(page, () => [window.__coldgas.S.mode, window.__coldgas.sandbox.active])).toEqual(['title', false]);
});

test('deep links: ?drive= wins over ?play=, and ?play= over ?board=', async ({ page }) => {
  await page.goto('/coldgas/?play=jump&board=today&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown', null, { timeout: 60_000 });
  await expect(page.locator('[data-screen="board"]')).toBeHidden();
});

for (const phone of [true, false]) {
  test(`${phone ? 'phone (4× CPU)' : 'desktop'}: the first Jump starts at once, with the reference ghost`, { tag: '@perf' }, async ({ browser }) => {
    test.slow();   // a throttled CPU on software GL
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask API */ }
    });
    await page.goto('/coldgas/?gfx=low');
    await ready(page);
    // Software GL draws every frame on the CPU (each one is a "long task" here, 0.2–2 s), which a
    // phone's GPU does not: measure the page's own work with the draw call stubbed out.
    await G(page, () => { window.__coldgas.stage.render = () => {}; });
    if (phone) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    // The title has been up a while: the course on show has its reference ghost (flown in slices
    // since the engine came up), and the other courses' flights are done too.
    const tReady = await G(page, () => performance.now());
    await page.waitForFunction(() => window.__coldgas.refGhostReady(window.__coldgas.stage.course), null, { timeout: 60_000, polling: 50 });
    console.log(`${phone ? 'phone' : 'desktop'}: the Show's reference ghost ready ${Math.round(await G(page, () => performance.now()) - tReady)} ms after the engine`);
    await ghostsReady(page);
    // A player who has touched the title before (here the course already chosen, a no-op): the
    // first gesture builds the audio graph. Headless Chromium has no audio device and its
    // AudioContext constructor alone takes ≈300 ms, which a phone's does not.
    const chip = page.locator('[data-course][aria-checked="true"]:visible').first();
    if (phone) await chip.tap(); else await chip.click();
    await page.waitForTimeout(300);
    const t0 = await G(page, () => performance.now());
    if (phone) await page.locator('[data-start]').tap(); else await page.locator('[data-start]').click();
    // The countdown's first frame: a frame drawn after the mode turned to countdown.
    const t1 = await G(page, () => new Promise((resolve) => {
      const wait = () => (window.__coldgas.S.mode === 'countdown' ? requestAnimationFrame(() => resolve(performance.now())) : requestAnimationFrame(wait));
      wait();
    }));
    const long = await G(page, ([a, b]) => window.__long.filter((e) => e.t + e.ms >= a && e.t <= b), [t0, t1]);
    console.log(`${phone ? 'phone' : 'desktop'}: tap → countdown frame ${Math.round(t1 - t0)} ms; long tasks ${JSON.stringify(long.map((e) => Math.round(e.ms)))}`);
    // The bar is 50 ms (a frame and a half at 30 fps), the old tap ran ≈1,280 ms. CI's runner is
    // about twice as slow as the dev machine the 4× phone profile was calibrated on, so at 4× there
    // it is an ≈8× phone: one 77–84 ms task (the countdown's first HUD layout) measured there with
    // no reference flight in it. CI holds the line at 150 ms; the 50 ms bar is checked locally.
    const bar = process.env.CI && phone ? 150 : 50;
    expect(long.filter((e) => e.ms > bar)).toEqual([]);
    expect(await G(page, () => window.__coldgas.refGhostRoot.visible)).toBe(true);
    await ctx.close();
  });
}
