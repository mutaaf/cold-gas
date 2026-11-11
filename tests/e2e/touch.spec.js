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
  const cdp = await page.context().newCDPSession(page);
  // 0123: a first touch on the road, off the pad, is seen and not taken: the pad pulses, the cue says
  // "Hold the pad" once, and nothing reaches the sim (no input logged, no press, the car stays put).
  await live(page);
  const off = { x: 195, y: 420 };
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-onethumb], button'), off)).toBe(false);
  // The pulse lives 400 ms: a mutation observer keeps a mark of it, so a slow frame can't hide it from the poll.
  const was = await page.evaluate(() => {
    const { S } = window.__coldgas, el = document.querySelector('[data-onethumb]');
    window.__nudged = false;
    new MutationObserver(() => { if (el.hasAttribute('data-nudge')) window.__nudged = true; }).observe(el, { attributes: true, attributeFilter: ['data-nudge'] });
    return { log: S.run.inputLog.length, z: S.run.car.pos.z, n: S.nudge.n };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...off, id: 9 }] });
  await page.waitForFunction(() => window.__nudged, null, { timeout: 10_000 });
  await expect(page.locator('[data-cue]')).toHaveText('Hold the pad');
  await page.waitForTimeout(500);
  const held = await page.evaluate(() => { const { S, thumb } = window.__coldgas; return { log: S.run.inputLog.length, z: S.run.car.pos.z, n: S.nudge.n, held: thumb.held, on: document.querySelector('[data-onethumb]').classList.contains('on') }; });
  expect(held).toMatchObject({ log: was.log, n: was.n + 1, held: false, on: false });
  expect(Math.abs(held.z - was.z)).toBeLessThan(0.05);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(pad).not.toHaveAttribute('data-nudge', '');
  // A second miss inside 3 s doesn't pulse again (the last pulse is set to just now, so slow CI timers can't open the gap).
  await page.evaluate(() => { window.__coldgas.S.nudge.at = performance.now(); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...off, id: 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.__coldgas.S.nudge.n)).toBe(was.n + 1);
  // Hold: the car climbs. Let go: it brakes.
  const box = await pad.boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await page.waitForFunction(() => window.__coldgas.S.run.car.pos.z > -5.5, null, { timeout: 30_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // The ledge (the drill hangs there): the pad says tap, and a tap lets go.
  await page.evaluate(() => window.__coldgas.startDrill('ledge'));
  await live(page);
  await expect(page.locator('[data-thumb-act]')).toHaveText('Let go');
  // 0133: every word the descent's state box shows in the air, from the tap to the touchdown, each rendered frame,
  // with whether the pad was held on that frame (critic bounce: "Hold · Land" on a held pad asks for what the
  // player is already doing).
  await page.evaluate(() => {
    const el = document.querySelector('[data-d-state]'), panel = document.querySelector('[data-descent]');
    const pad = document.querySelector('[data-onethumb]');
    window.__dWords = [];
    const look = () => {
      const { S } = window.__coldgas;
      if (S.mode === 'live' && S.run?.phase === 'air' && !panel.hidden) window.__dWords.push({ w: el.textContent, on: pad.classList.contains('on'), l: S.run.car.autoLand > 0 || window.__coldgas.thumb.landing, warn: pad.hasAttribute('data-warn') });
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 2 }] });
  await page.waitForFunction(() => window.__coldgas.S.released, null, { timeout: 30_000 });
  // Keep holding: LAND (the level channel) goes into the input log, in Assist.
  await expect(page.locator('[data-thumb-act]')).toHaveText('Aim');   // 0188: held, LAND is on and the hold aims
  const level = await ch(page, 'level');
  await page.waitForFunction((i) => window.__coldgas.S.run.inputLog.some((e) => e[i] === 100), level, { timeout: 30_000 });
  // Held through the roll-out off the ledge: the first air frames are the ones the bounce caught.
  await page.waitForFunction(() => window.__dWords.filter((f) => f.on).length >= 6 || window.__coldgas.S.run.phase === 'done', null, { timeout: 60_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.__coldgas.S.run.inputLog.every((e) => e[window.__coldgas.inputKeys.indexOf('assist') + 1] === 100))).toBe(true);
  // Lifted after holding, LAND stays on: the box reads Landing, never a roll or a brake this scheme hasn't got
  // (0133), and never Hold · Land (0188).
  await page.waitForFunction(() => { const { S } = window.__coldgas; return S.mode !== 'live' || S.run.phase !== 'air'; }, null, { timeout: 60_000 });
  const frames = await page.evaluate(() => window.__dWords);
  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) expect(['On profile', 'Hold · Land', 'Landing']).toContain(f.w);
  // 0188: once LAND flies (held once, or auto-land), nothing asks for a press that changes nothing but the aim.
  expect(frames.filter((f) => f.l && (f.warn || f.w === 'Hold · Land'))).toEqual([]);
  const onPad = frames.filter((f) => f.on);
  expect(onPad.length).toBeGreaterThan(0);
  expect(onPad.filter((f) => f.w !== 'On profile')).toEqual([]);
  // 0188: the tapped thumb (most phone players): a tap on the ledge, lifted, never pressed again. Once auto-land
  // flies, the pad is calm (no data-warn) and names the aim, never Land. Stepped in the page: no frame waits.
  const tapped = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S, pad = document.querySelector('[data-onethumb]'), act = document.querySelector('[data-thumb-act]');
    g.startDrill('ledge');
    S.freezeT = 0;
    const seen = [];
    g.thumb.down();
    for (let i = 0; i < 20; i++) g.liveStep(1 / 240);
    g.thumb.up();
    for (let i = 0; i < 2400 && S.mode === 'live' && S.run.phase !== 'done'; i++) {
      g.liveStep(1 / 240);
      if (S.run.phase === 'air') seen.push({ auto: S.run.car.autoLand > 0, warn: pad.hasAttribute('data-warn'), a: act.textContent });
    }
    return seen;
  });
  const auto = tapped.filter((f) => f.auto);
  expect(auto.length).toBeGreaterThan(60);
  expect(auto.filter((f) => f.warn || f.a !== 'Aim')).toEqual([]);
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
