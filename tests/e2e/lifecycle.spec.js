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
  await page.evaluate(() => { document.querySelector('[data-play-more]').open = true; });   // More ways to play (the title's disclosure)
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
  expect(await G(page, () => ({ mode: window.__coldgas.S.mode, active: window.__coldgas.drive.active, near: window.__coldgas.camera.near, far: window.__coldgas.camera.far }))).toEqual({ mode: 'title', active: false, near: 0.3, far: 3000 });   // the stage's own planes (0046)
  await expect(page.locator('[data-drive-hud]')).toBeHidden();
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
});

test('a double tap on Sandbox builds one arena, and the title takes it down', async ({ page }) => {
  test.slow();   // the arena builds and compiles on software GL
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { document.querySelector('[data-play-more]').open = true; });   // More ways to play (the title's disclosure)
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
    // …and the next run's engine world is built, between frames, so the tap doesn't build it.
    await page.waitForFunction(() => window.__coldgas.spareRun() === window.__coldgas.stage.course, null, { timeout: 30_000, polling: 50 });
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
    expect(await G(page, () => window.__coldgas.spareRun())).toBe(null);   // the run took it
    await ctx.close();
  });
}

// Pause, background and return (0060): pause goes quiet for real, a resize while paused redraws the
// frozen frame, and the screen stays on through a run, the judging and the replay.
const live = async (page) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.waitForFunction(() => window.__coldgas.stage.renderer.info.render.frame > 0, null, { timeout: 60_000 });   // the stage draws
  await page.mouse.click(5, 5);   // a gesture: the audio graph is built (src/main.js)
  await G(page, () => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
};
const audio = (page) => G(page, () => window.__coldgas.life.audio());

for (const phone of [true, false]) {
  test(`${phone ? 'phone' : 'desktop'}: pause suspends the audio, resume brings it back, hidden goes quiet`, async ({ browser }) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await live(page);
    await expect.poll(() => audio(page)).toBe('running');
    await page.keyboard.press('Escape');   // a gesture of its own: it must not wake the audio it pauses
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
    await expect.poll(() => audio(page)).toBe('suspended');
    // Any other key or tap on the pause sheet is a gesture too: it must not bring the sound back.
    await page.keyboard.press('KeyG');
    await page.locator('[data-screen="pause"]').click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(500);
    expect(await audio(page)).toBe('suspended');
    await page.locator('[data-resume]').click();
    await expect.poll(() => audio(page)).toBe('running');
    // A hidden tab: paused and quiet; back, a tap on Resume brings the sound back.
    await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => audio(page)).toBe('suspended');
    await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    expect(await audio(page)).toBe('suspended');   // still paused: still quiet
    await page.locator('[data-resume]').click();
    await expect.poll(() => audio(page)).toBe('running');
    await ctx.close();
  });
}

test('a resize while paused redraws the frozen frame: the canvas is not blank', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await live(page);
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  const frames = () => G(page, () => window.__coldgas.stage.renderer.info.render.frame);
  const before = await frames();
  await page.waitForTimeout(400);
  expect(await frames()).toBe(before);   // paused: the loop draws nothing
  await page.setViewportSize({ width: 390, height: 844 });   // a rotation to a phone's shape
  await expect.poll(frames).toBeGreaterThan(before);
  await page.waitForTimeout(600);   // past the buffer's settle (scene.js SETTLE_MS): it was reallocated and drawn again
  await G(page, () => { document.querySelector('[data-screen="pause"]').style.visibility = 'hidden'; });
  const png = (await page.locator('#stage').screenshot()).toString('base64');
  // Spread of the canvas's pixels, measured in the page (no image library here): a cleared canvas is one colour.
  const spread = await G(page, (b64) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l; }
      resolve(hi - lo);
    };
    img.src = `data:image/png;base64,${b64}`;
  }), png);
  expect(spread).toBeGreaterThan(30);
});

test('the screen stays on through a run, the judging and the replay, and lets go on the title and when paused', async ({ page }) => {
  // Headless Chromium's wake lock depends on the platform: a stand-in records what the page asks for.
  await page.addInitScript(() => {
    window.__wake = { held: 0, asks: 0 };
    const request = () => {
      window.__wake.asks++; window.__wake.held++;
      const l = new EventTarget();
      l.release = async () => { if (l.released) return; l.released = true; window.__wake.held--; l.dispatchEvent(new Event('release')); };
      return Promise.resolve(l);
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  });
  await live(page);
  const held = () => G(page, () => window.__wake.held);
  await expect.poll(held).toBe(1);
  expect(await G(page, () => window.__coldgas.life.wake())).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(held).toBe(0);
  await page.locator('[data-resume]').click();
  await expect.poll(held).toBe(1);
  // The browser drops the lock on a hidden page; back, the page asks again.
  const asks = await G(page, () => window.__wake.asks);
  await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(held).toBe(0);
  await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('[data-resume]').click();
  await expect.poll(held).toBe(1);
  expect(await G(page, () => window.__wake.asks)).toBe(asks + 1);
  // The judging and the replay: still held. The title: let go.
  await G(page, () => window.__coldgas.fastForward());
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  expect(await held()).toBe(1);
  await G(page, () => window.__coldgas.toTitle());
  await expect.poll(held).toBe(0);
});
