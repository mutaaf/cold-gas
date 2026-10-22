import { test, expect } from '@playwright/test';

// Keyboard, gamepad and touch on every device (0041), and nothing held comes back held (0042's input
// part): the last device used wins, keys never stick or misfire, and blur / hidden / pause let go.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const IPAD = { viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true };
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
const go = (page) => page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
const live = (page) => page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });

test('iPad with a keyboard: arrows drive the Show, and the touch controls step aside', async ({ browser }) => {
  test.slow(); // two runs at iPad size, each waiting on SwiftShader frames (≈30 s locally)
  const page = await browser.newPage(IPAD);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await go(page);
  await live(page);
  // A tablet starts on touch: one-thumb is on screen.
  await expect(page.locator('[data-onethumb]')).toBeVisible();
  // The tick and place the key went down at (SwiftShader frames are slow: time is the sim's clock).
  await page.evaluate(() => addEventListener('keydown', () => { const r = window.__coldgas.S.run; window.__t0 = { tick: r.tick, x: r.car.pos.x, z: r.car.pos.z }; }, { once: true, capture: true }));
  await page.keyboard.down('ArrowUp');
  // Moving within 2 s of sim time.
  const moved = await page.waitForFunction(() => {
    const r = window.__coldgas.S.run;
    return Math.hypot(r.car.pos.x - window.__t0.x, r.car.pos.z - window.__t0.z) > 0.5 ? r.tick - window.__t0.tick : 0;
  }, null, { timeout: 30_000 });
  expect(await moved.jsonValue()).toBeLessThanOrEqual(480);
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('[data-touch]')).toBeHidden();
  expect(await page.evaluate(() => window.__coldgas.input.device())).toBe('key');
  // The next run starts the way the player last played: keys, no touch controls.
  await go(page);
  await live(page);
  await expect(page.locator('[data-touch]')).toBeHidden();
  // A finger brings them back.
  await page.touchscreen.tap(512, 640);
  await expect(page.locator('[data-onethumb]')).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test('desktop: a touch on the canvas shows the touch controls; a key hides them again', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await go(page);
  await live(page);
  await expect(page.locator('[data-touch]')).toBeHidden();
  // A touchscreen laptop's finger (Playwright's desktop page has no touch screen: a real touch-type
  // pointer event is what the page listens for).
  await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, isPrimary: true })));
  await expect(page.locator('[data-touch]')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-touch]')).toBeHidden();
});

test('a mouse-clicked Retry keeps no focus: Space is LIFT, not another retry', async ({ page }) => {
  test.slow(); // a run, a retry and its countdown on SwiftShader (≈30 s locally)
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await go(page);
  await live(page);
  await page.locator('.top [data-again]').click();
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await live(page);
  await page.evaluate(() => { window.__coldgas.S.run.__mark = 1; });
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BUTTON');
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => [window.__coldgas.S.mode, window.__coldgas.S.run.__mark])).toEqual(['live', 1]);
  // Even with focus put back on it (Tab), Space during a run is the car's.
  await page.locator('.top [data-again]').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__coldgas.S.run.__mark)).toBe(1);
});

test('holding Escape pauses once; Cmd+Arrow leaves nothing stuck; a select keeps its keys', async ({ page }) => {
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await go(page);
  await live(page);
  // Four keydowns of one held Escape (the 2nd to 4th are auto-repeats): one toggle.
  for (let i = 0; i < 4; i++) await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(true);
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(false);
  // Cmd held, then an arrow: macOS never sends that arrow's keyup. It must not be held.
  await page.keyboard.down('Meta');
  await page.keyboard.down('ArrowLeft');
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'MetaLeft', key: 'Meta' })));
  expect((await page.evaluate(() => window.__coldgas.input.held())).keys).toEqual([]);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Meta');
  // A key typed into a select or a textarea is not the game's.
  await page.evaluate(() => {
    const s = document.createElement('select'); s.id = 'tsel'; s.innerHTML = '<option>a</option><option>b</option>';
    const t = document.createElement('textarea'); t.id = 'tta';
    document.body.append(s, t);
  });
  await page.locator('#tsel').focus();
  await page.keyboard.down('ArrowDown');
  expect((await page.evaluate(() => window.__coldgas.input.held())).keys).toEqual([]);
  await page.keyboard.up('ArrowDown');
  await page.locator('#tta').focus();
  await page.keyboard.down('KeyW');
  expect((await page.evaluate(() => window.__coldgas.input.held())).keys).toEqual([]);
  await page.keyboard.up('KeyW');
});

test('GO held, the tab hidden and back: nothing is held, nothing is lit', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => window.__coldgas.touch.set('scheme', 'classic'));
  await go(page);
  await live(page);
  const btn = page.locator('[data-btn-go]');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  await page.waitForFunction(() => window.__coldgas.input.held().go, null, { timeout: 10_000 });
  expect((await page.evaluate(() => window.__coldgas.input.held())).on).toBeGreaterThan(0);
  const vis = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await vis(true);
  await vis(false);
  const h = await page.evaluate(() => window.__coldgas.input.held());
  expect(h).toMatchObject({ keys: [], go: false, brk: false, lift: false, land: false, x: 0, y: 0, thumb: false, nozzle: false, on: 0 });
  // The run is paused by the hidden tab; the sheet's Resume brings it back with nothing held.
  expect(await page.evaluate(() => window.__coldgas.S.paused)).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.close();
});

test('one-thumb held, then the window loses focus: the pad lets go', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await go(page);
  await live(page);
  const pad = page.locator('[data-onethumb]');
  const box = await pad.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  await page.waitForFunction(() => window.__coldgas.input.held().thumb, null, { timeout: 10_000 });
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__coldgas.input.held())).toMatchObject({ thumb: false, on: 0 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.close();
});

test('phone in Classic: the cue names the touch button before any press', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => window.__coldgas.touch.set('scheme', 'classic'));
  await go(page);
  await live(page);
  await expect(page.locator('[data-cue]')).toContainText('GO');
  await expect(page.locator('[data-cue]')).not.toContainText('↑');
  await page.close();
});

test('tilt: a saved On asks iOS again on the next Jump tap; turning the phone zeroes it again', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await page.addInitScript(() => {
    localStorage.setItem('coldgas_touch', JSON.stringify({ scheme: 'classic', tilt: true }));
    window.__asked = 0;
    if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class extends Event {};
    window.DeviceOrientationEvent.requestPermission = async () => { window.__asked++; return 'granted'; };
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  expect(await page.evaluate(() => window.__asked)).toBe(0);
  await page.locator('.cta [data-start]').tap();
  await page.waitForFunction(() => window.__asked === 1, null, { timeout: 10_000 });
  await page.evaluate(() => window.__coldgas.skipCountdown());
  await live(page);
  const orient = (beta, gamma) => page.evaluate(([b, g]) => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: b, gamma: g })), [beta, gamma]);
  await orient(30, 0);            // the first reading is straight ahead
  await orient(50, 20);           // 20° right on either axis the emulated screen reads
  await expect.poll(() => page.evaluate(() => window.__coldgas.touch.tilt())).toBe(1);
  // The phone turned round: the next reading is the new straight ahead.
  await page.evaluate(() => screen.orientation.dispatchEvent(new Event('change')));
  expect(await page.evaluate(() => window.__coldgas.touch.tilt())).toBe(0);
  await orient(50, 20);
  expect(await page.evaluate(() => window.__coldgas.touch.tilt())).toBe(0);
  await page.close();
});
