import { test, expect } from '@playwright/test';

// Touch: the one-thumb Assist scheme (hold to climb, tap to let go, hold to land), the Controls
// sheet, and tilt steering (off by default, permission-gated, calibrated).
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ready = (page) => page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
const live = (page) => page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 30_000 });
const ch = (page, name) => page.evaluate((name) => window.__coldgas.inputKeys.indexOf(name) + 1, name);

test('one-thumb: hold to climb, tap to let go on the ledge, hold to land', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.evaluate(() => { window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  // One-thumb is the touch default on the Show: one pad, no stick, no pedals.
  const pad = page.locator('[data-onethumb]');
  await expect(pad).toBeVisible();
  await expect(pad).toBeInViewport();
  await expect(page.locator('[data-stick]')).toBeHidden();
  await expect(page.locator('[data-btn-go]')).toBeHidden();
  await expect(page.locator('[data-thumb-act]')).toHaveText('Climb');
  // Hold: the car climbs. Let go: it brakes.
  const box = await pad.boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -5.5, null, { timeout: 30_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // The ledge (the drill hangs there): the pad says tap, and a tap lets go.
  await page.evaluate(() => window.__coldgas.startDrill('ledge'));
  await live(page);
  await expect(page.locator('[data-thumb-act]')).toHaveText('Let go');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 2 }] });
  await page.waitForFunction(() => window.__coldgas.S.released, null, { timeout: 30_000 });
  // Keep holding: LAND (the level channel) goes into the input log, in Assist.
  await expect(page.locator('[data-thumb-act]')).toHaveText('Land');
  const level = await ch(page, 'level');
  await page.waitForFunction((i) => window.__coldgas.S.run.inputLog.some((e) => e[i] === 100), level, { timeout: 30_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.__coldgas.S.run.inputLog.every((e) => e[window.__coldgas.inputKeys.indexOf('assist') + 1] === 100))).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

test('controls sheet: classic brings back the stick; tilt is off by default, turns on and steers', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  // iOS asks for motion access from a tap; stand in for its prompt (and count that it was asked).
  await page.addInitScript(() => {
    window.__asked = 0;
    if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class extends Event {};
    window.DeviceOrientationEvent.requestPermission = async () => { window.__asked++; return 'granted'; };
  });
  await page.goto('/coldgas/?gfx=low');
  await ready(page);
  await page.locator('.cta [data-controls-open]').tap();
  await expect(page.locator('[data-screen="controls"]')).toBeVisible();
  const tilt = page.locator('[data-tilt]');
  await expect(tilt).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-tilt-calibrate]')).toBeHidden();
  await page.locator('[data-scheme-opt="classic"]').tap();
  await tilt.tap();
  await expect(tilt).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-tilt-calibrate]')).toBeVisible();
  expect(await page.evaluate(() => window.__asked)).toBe(1);
  // Held level, calibrate; then tilt 20° to the right.
  // A sensor reading (headless Chromium has no sensor; its own events carry nulls, which are ignored).
  const orient = (beta, gamma) => page.evaluate(([b, g]) => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: b, gamma: g })), [beta, gamma]);
  await orient(30, 0);
  await page.waitForTimeout(300);
  await page.locator('[data-tilt-calibrate]').tap();
  await page.locator('[data-controls-close]').tap();
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await expect(page.locator('[data-stick]')).toBeVisible();
  await expect(page.locator('[data-onethumb]')).toBeHidden();
  // 20° to the right whichever way up the emulated screen reports itself (gamma in portrait, beta at 90°).
  await orient(50, 20);
  const steer = await ch(page, 'steer');
  await page.waitForFunction((i) => window.__coldgas.S.run.inputLog.some((e) => e[i] >= 90), steer, { timeout: 30_000 });
  // Off again: no steer from the phone.
  await page.evaluate(() => window.__coldgas.toTitle());
  await page.locator('.cta [data-controls-open]').tap();
  await tilt.tap();
  await expect(tilt).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-scheme-opt="thumb"]').tap();
  await page.locator('[data-controls-close]').tap();
  await page.close();
});
