import { test, expect } from '@playwright/test';

// 0099: a restart lets go of everything, like pause. "After restarting I often just get stuck in a lift or
// fly mode": a key, a finger or a pad held across Retry (the HUD's, R, the results', the theatre's, the
// pause sheet's Restart, during the aftermath) stayed held into the new run. Space held across R lifted
// the car off the line and called it released inside a second; a finger left on LAND boosted the next
// run-up. Now everything held is let go at the start of a run and counts again only on a fresh press
// (a key's auto-repeat doesn't bring it back; a pad must come to rest first).
// A boot and five runs per test on software GL: the sim is stepped in the page, but the boots are slow.
test.slow();

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const G = (page, fn, a) => page.evaluate(fn, a);
const KEYS = ['Space', 'ArrowUp', 'ShiftLeft'];

async function boot(page, scheme) {
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre open
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  if (scheme) await G(page, (s) => window.__coldgas.touch.set('scheme', s), scheme);
}
// A live run with the frame loop held still (the test steps the sim), Assist.
const startLive = (page) => G(page, () => { const cg = window.__coldgas; cg.setTier('assist'); cg.startRun('jump'); cg.skipCountdown(); cg.S.paused = true; });
// The reference flies the car off the ledge, then hands it back in the air (the touch layer's LAND).
const toAir = (page) => G(page, () => {
  const cg = window.__coldgas, S = cg.S;
  S.autopilot = cg.createAutopilot('show');
  for (let i = 0; i < 4000 && !(S.released && S.run.phase === 'air' && S.run.tick - S.releaseTick > 120); i++) cg.liveStep(1 / 60);
  S.autopilot = null; cg.liveStep(1 / 60);
});
const centre = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const SEL = { hud: '.top .quick-retry', aftermath: '.top .quick-retry', results: '[data-screen="results"] .retry-btn', theatre: '.th-quick [data-again]', pause: '[data-restart]' };

// Restart from `path` with whatever the test holds still held. `tap`: the button is activated by the
// page (a phone: CDP's second finger is no tap while the first is down, so the button is clicked).
async function restart(page, path, { tap = false } = {}) {
  await G(page, () => { window.__oldRun = window.__coldgas.S.run; });
  if (path === 'results' || path === 'theatre') {
    await G(page, () => { const cg = window.__coldgas; for (let i = 0; i < 6000 && cg.S.mode === 'live'; i++) cg.liveStep(0.1); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30_000 });
  }
  if (path === 'aftermath') {
    await G(page, () => { const cg = window.__coldgas; for (let i = 0; i < 6000 && !cg.S.after; i++) cg.liveStep(0.1); });
    expect(await G(page, () => [window.__coldgas.S.after, window.__coldgas.S.mode])).toEqual([true, 'live']);
  }
  if (path === 'pause') {
    // Paused the way a phone pauses (the tab goes hidden and comes back), then the sheet's Restart.
    await G(page, () => { const cg = window.__coldgas; cg.S.paused = false; const set = (v) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }; set(true); set(false); });
    await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  }
  if (path === 'R') await page.keyboard.press('KeyR');
  else {
    if (path === 'theatre') {
      // A phone runs the call docked on the sheet (audit 2026-10-30): Watch the call puts the theatre up.
      await page.waitForFunction(() => { const w = document.querySelector('[data-call-watch]'); return (w && w.offsetParent) || !document.querySelector('[data-theatre]').hidden; }, null, { timeout: 30_000 });
      await G(page, () => { const w = document.querySelector('[data-call-watch]'); if (w && w.offsetParent) w.click(); });
      await expect(page.locator(SEL.theatre)).toBeVisible({ timeout: 30_000 });
    }
    if (tap) await G(page, (s) => [...document.querySelectorAll(s)].find((b) => b.offsetParent).click(), SEL[path]);
    else await page.locator(SEL[path]).first().click();
  }
  expect(await G(page, () => [window.__coldgas.S.run !== window.__oldRun, window.__coldgas.S.mode])).toEqual([true, 'countdown']);
}
// The countdown ends and the new run goes for a second of sim time; `repeat` keys auto-repeat as a held
// key does. What the new run's input log carries, and what is held at the end of it.
async function newRunSecond(page, repeat = []) {
  await G(page, () => { window.__coldgas.skipCountdown(); window.__coldgas.S.paused = true; });
  for (let k = 0; k < 4; k++) {
    for (const code of repeat) await page.keyboard.down(code);   // already down: Playwright sends a repeat
    await G(page, () => { for (let i = 0; i < 15; i++) window.__coldgas.liveStep(1 / 60); });
  }
  return G(page, () => {
    const cg = window.__coldgas, S = cg.S, ik = cg.inputKeys, used = [];
    for (const name of ['throttle', 'lift', 'level', 'thrust']) { const i = ik.indexOf(name) + 1; if (S.run.inputLog.some((e) => e[i] > 0)) used.push(name); }
    return { used, held: cg.input.held(), released: S.released, phase: S.run.phase };
  });
}
const NOTHING = { keys: [], go: false, brk: false, lift: false, land: false, thumb: false, nozzle: false, on: 0 };
const pressAgain = (page) => G(page, () => {
  const cg = window.__coldgas, i = cg.inputKeys.indexOf('throttle') + 1;
  for (let k = 0; k < 30; k++) cg.liveStep(1 / 60);
  return cg.S.run.inputLog.some((e) => e[i] > 0);
});

test('keyboard: Space, ↑ and Shift held across every Retry drive nothing until pressed again', async ({ page }) => {
  await boot(page);
  for (const path of ['hud', 'R', 'results', 'pause', 'aftermath']) {
    await startLive(page);
    for (const k of KEYS) await page.keyboard.down(k);
    await restart(page, path);
    const r = await newRunSecond(page, KEYS);
    expect(r, path).toMatchObject({ used: [], released: false, phase: 'drive', held: { keys: [] } });
    for (const k of KEYS) await page.keyboard.up(k);
    // A fresh press is the car's again.
    await page.keyboard.down('ArrowUp');
    expect(await pressAgain(page), path).toBe(true);
    await page.keyboard.up('ArrowUp');
  }
});

test('phone, classic: GO, LAND and BOOST held across Retry (HUD, theatre, aftermath) are let go', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await boot(page, 'classic');
  const cdp = await page.context().newCDPSession(page);
  for (const [path, air] of [['hud', false], ['theatre', true], ['aftermath', false], ['pause', true]]) {
    await startLive(page);
    if (air) await toAir(page);
    const held = air ? [await centre(page, '[data-btn-land]'), await centre(page, '[data-btn-go]')] : [await centre(page, '[data-btn-go]')];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: held.map((p, i) => ({ ...p, id: i + 1 })) });
    expect(await G(page, () => window.__coldgas.input.held().on), path).toBe(held.length);
    await restart(page, path, { tap: true });
    // READY shows the run-up's controls, not the last run's LAND or its landed BRAKE.
    expect(await G(page, () => document.querySelector('[data-touch]').dataset.phase), path).toBe('ground');
    const r = await newRunSecond(page);
    expect(r, path).toMatchObject({ used: [], released: false, phase: 'drive', held: NOTHING });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // A fresh press on GO drives.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...(await centre(page, '[data-btn-go]')), id: 7 }] });
    expect(await pressAgain(page), path).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.close();
});

test('phone, one-thumb: the pad held across the results\' Retry is let go, unlit, and answers a fresh press', async ({ browser }) => {
  const page = await browser.newPage(PHONE);
  await boot(page, 'thumb');
  const cdp = await page.context().newCDPSession(page);
  await startLive(page);
  const p = await centre(page, '[data-onethumb]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
  expect(await G(page, () => window.__coldgas.thumb.held)).toBe(true);
  await restart(page, 'results', { tap: true });
  await expect(page.locator('[data-thumb-act]')).toHaveText('Climb');   // the countdown's pad is the run-up's
  const r = await newRunSecond(page);
  expect(r).toMatchObject({ used: [], released: false, held: NOTHING });
  expect(await G(page, () => document.querySelector('[data-onethumb]').classList.contains('on'))).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 2 }] });
  expect(await G(page, () => window.__coldgas.thumb.held)).toBe(true);
  expect(await pressAgain(page)).toBe(true);   // hold to climb
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.close();
});

test('gamepad: A and RT held across Retry wait until the pad is let go', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await boot(page);
  const press = (on) => G(page, (v) => { for (const b of [0, 7]) { window.__pad.buttons[b].pressed = v; window.__pad.buttons[b].value = v ? 1 : 0; } }, on);
  await startLive(page);
  await press(true);
  await G(page, () => { window.__coldgas.S.paused = false; });
  await restart(page, 'hud');
  const r = await newRunSecond(page);
  expect(r).toMatchObject({ used: [], released: false, phase: 'drive' });
  // Let go (a frame sees it at rest), press again: the pad drives.
  await press(false);
  await page.waitForTimeout(300);
  await press(true);
  await page.waitForTimeout(300);
  expect(await pressAgain(page)).toBe(true);
});
