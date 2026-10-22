import { test, expect } from '@playwright/test';

// Ticket 0061: on a phone the stats covered the road. Phones and small tablets start with the compact
// HUD (one slim line docked where the car never goes, src/hud-mode.js); one tap on the handle brings
// out every instrument and another folds them, kept on this device. The coverage tests sample every
// frame: the HUD's boxes as a share of the screen, and whether the car's centre (carRoot through the
// camera) is under any of them. The cue line, the top bar and the touch controls are not counted.
// Every test has its own page: let the runner spread them over its workers (the flights are slow).
test.describe.configure({ mode: 'parallel' });
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true });
const boot = async (page, q = '') => {
  await page.goto(`/coldgas/?gfx=low${q}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
};
// (physicsReady is a function: wait on it, docs/LESSONS.md.)
const physics = (page) => page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 30_000 });
const live = async (page, kind = 'jump') => {
  await physics(page);
  await page.evaluate((kind) => { window.__coldgas.startRun(kind); window.__coldgas.skipCountdown(); }, kind);
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
};
const mode = (page) => page.evaluate(() => document.documentElement.dataset.hud);
const stored = (page) => page.evaluate(() => localStorage.getItem('coldgas_hud'));
const box = (page, sel) => page.locator(sel).boundingBox();
const apart = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;

// The per-frame probe, run in the page until stopped: every visible HUD box (the Show's instrument
// boxes, Free Drive's and the Sandbox's, the handle) rasterised on a 4 px grid.
function startProbe() {
  const SEL = '[data-hud-box], [data-hud-toggle], .fd-road, .fd-ctl, .fd-timer, .fd-speed, .fd-stats, .fd-map, .fd-fine, .bq-dock';
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const C = 4, w = innerWidth, h = innerHeight, gw = Math.ceil(w / C), gh = Math.ceil(h / C), grid = new Uint8Array(gw * gh);
  const st = { frames: 0, seen: 0, under: [], maxCover: 0, stop: false };
  const v = window.__coldgas.carRoot.position.clone();
  const tick = () => {
    if (st.stop) return;
    const rects = [...document.querySelectorAll(SEL)].filter(vis).map((el) => [el, el.getBoundingClientRect()]);
    grid.fill(0);
    for (const [, r] of rects) {
      for (let y = Math.max(0, Math.floor(r.top / C)); y < Math.min(gh, Math.ceil(r.bottom / C)); y++) {
        for (let x = Math.max(0, Math.floor(r.left / C)); x < Math.min(gw, Math.ceil(r.right / C)); x++) grid[y * gw + x] = 1;
      }
    }
    let n = 0;
    for (let i = 0; i < grid.length; i++) n += grid[i];
    st.maxCover = Math.max(st.maxCover, n / grid.length);
    st.frames++;
    v.copy(window.__coldgas.carRoot.position).project(window.__coldgas.camera);
    const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
    if (v.z < 1 && px >= 0 && px <= w && py >= 0 && py <= h) {
      st.seen++;
      const hit = rects.find(([, r]) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom);
      if (hit && st.under.length < 20) st.under.push(`${hit[0].dataset.hudBox || hit[0].className} @ ${Math.round(px)},${Math.round(py)} ${window.__coldgas.S.run?.phase || ''}`);
    }
    requestAnimationFrame(tick);
  };
  window.__hudProbe = st;
  requestAnimationFrame(tick);
}
// The coverage probes measure DOM boxes against the camera's projection of the car: the canvas's
// resolution never enters. Draw it at a quarter of the pixels (and keep the resolution governor from
// raising it), so CI's software GL keeps up with a whole flight at 820×1180: at a few frames a second
// the 0.1 s frame cap stretched the Show's flight past the 150 s wait on a busy runner.
const lean = (page) => page.evaluate(() => { const s = window.__coldgas.stage; s.setPixelScale(0.5); s.setPixelScale = () => {}; });
const stopProbe = (page) => page.evaluate(() => { const st = window.__hudProbe; st.stop = true; return st; });

test('phone: compact by default; one tap shows every instrument, another folds them, and it is kept', async ({ browser }) => {
  test.slow();   // a reload and a run start on software GL
  const page = await browser.newPage(touch(390, 844));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await live(page);
  const handle = page.locator('.hud [data-hud-toggle]');
  expect(await mode(page)).toBe('compact');
  await expect(page.locator('[data-hud-box="strip"]')).toBeVisible();
  for (const sel of ['[data-hud-box="att"]', '[data-hud-box="vehicle"]', '[data-ch="pitch"]', '[data-ch="fan"]']) await expect(page.locator(sel)).toBeHidden();
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect(handle).toHaveAccessibleName(/Show all instruments/);
  let hb = await box(page, '.hud [data-hud-toggle]');
  expect(hb.width).toBeGreaterThanOrEqual(44);
  expect(hb.height).toBeGreaterThanOrEqual(44);
  // One tap: everything.
  await handle.tap();
  expect(await mode(page)).toBe('full');
  for (const sel of ['[data-hud-box="att"]', '[data-hud-box="vehicle"]', '[data-ch="pitch"]', '[data-ch="fan"]']) await expect(page.locator(sel)).toBeVisible();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  hb = await box(page, '.hud [data-hud-toggle]');
  expect(hb.width).toBeGreaterThanOrEqual(44);
  expect(hb.height).toBeGreaterThanOrEqual(44);
  // The tab stands clear of the dial and the vehicle panel.
  for (const k of ['att', 'vehicle', 'primary', 'mission']) {
    const b = await box(page, `[data-hud-box="${k}"]`);
    if (b) expect(apart(hb, b), `${k} ${JSON.stringify({ hb, b })}`).toBe(true);
  }
  expect(await stored(page)).toBe('full');
  // Kept on this device.
  await page.reload();
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
  expect(await mode(page)).toBe('full');
  await live(page);
  await handle.tap();
  expect(await mode(page)).toBe('compact');
  expect(await stored(page)).toBe('compact');
  // A tap leaves no focus behind (Space is the game's).
  expect(await page.evaluate(() => document.activeElement?.hasAttribute?.('data-hud-toggle') || false)).toBe(false);
  // The keyboard path: the handle answers Enter, and I switches from anywhere.
  await handle.focus();
  await page.keyboard.press('Enter');
  expect(await mode(page)).toBe('full');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('KeyI');
  expect(await mode(page)).toBe('compact');
  await page.reload();
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30_000 });
  expect(await mode(page)).toBe('compact');
  expect(errors).toEqual([]);
  await page.close();
});

test('desktop keeps every instrument; I folds them and the handle brings them back', async ({ page }) => {
  await boot(page);
  await live(page);
  expect(await mode(page)).toBe('full');
  await expect(page.locator('[data-hud-box="att"]')).toBeVisible();
  await expect(page.locator('.hud [data-hud-toggle]')).toBeHidden();   // today's layout, untouched
  await page.keyboard.press('KeyI');
  expect(await mode(page)).toBe('compact');
  await expect(page.locator('[data-hud-box="att"]')).toBeHidden();
  await page.locator('.hud [data-hud-toggle]').click();
  expect(await mode(page)).toBe('full');
  await expect(page.locator('[data-hud-box="att"]')).toBeVisible();
});

test('compact phone: the landing cues stay up (the descent band, its state, the BRAKE line, the ring)', async ({ browser }) => {
  const page = await browser.newPage(touch(390, 844));
  await boot(page);
  expect(await mode(page)).toBe('compact');
  await physics(page);
  await page.evaluate(() => { window.__coldgas.setTier('pro'); window.__coldgas.startDrill('land'); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  // The drill starts under a second from the ground: hold the sim the moment the marker is up.
  await page.waitForFunction(() => { const on = window.__coldgas.landing.marker.visible; if (on) window.__coldgas.S.paused = true; return on; }, null, { timeout: 10_000, polling: 'raf' });
  await expect(page.locator('[data-descent]')).toBeVisible();
  await expect(page.locator('.d-tape')).toBeVisible();
  await expect(page.locator('[data-d-state]')).toBeVisible();
  await expect(page.locator('[data-d-brake-lbl]')).toContainText('BRAKE');
  await expect(page.locator('[data-ch="sink"]')).toBeVisible();
  // Nothing of the descent sits under the rail or the top bar.
  const d = await box(page, '[data-hud-box="primary"]'), s = await box(page, '[data-hud-box="strip"]');
  expect(apart(d, s), JSON.stringify({ d, s })).toBe(true);
  await page.close();
});

// The numbers (ticket 0061): the Show's reference flight and a Free Drive run, compact, at a phone
// upright, a phone sideways and an 11" tablet upright. The HUD covers at most 12 % of the screen and
// the car's centre is never under it.
const VIEWS = [[390, 844], [844, 390], [820, 1180]];
for (const [w, h] of VIEWS) {
  test(`compact, the Show's reference flight at ${w}×${h}: HUD ≤ 12 % of the screen, never over the car`, async ({ browser }) => {
    test.slow();   // the whole flight, frame by frame, on software GL
    const page = await browser.newPage(touch(w, h));
    await boot(page);
    expect(await mode(page)).toBe('compact');
    await lean(page);
    await live(page, 'reveal');
    await page.evaluate(startProbe);
    await page.waitForFunction(() => window.__coldgas.S.mode !== 'live', null, { timeout: 150_000, polling: 1000 });
    const st = await stopProbe(page);
    expect(st.seen, 'frames with the car on screen').toBeGreaterThan(60);
    expect(st.under, 'frames with the car under the HUD').toEqual([]);
    expect(st.maxCover, 'largest share of the screen under the HUD').toBeLessThanOrEqual(0.12);
    await page.close();
  });

  test(`@heavy compact, Free Drive at ${w}×${h}: HUD ≤ 12 % of the screen, never over the car`, async ({ browser }) => {
    test.slow();   // the road world builds and compiles on software GL (@heavy: the flake guard runs it 2×)
    const page = await browser.newPage(touch(w, h));
    await page.goto('/coldgas/?drive=stelvio&gfx=low');
    await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90_000 });
    expect(await mode(page)).toBe('compact');
    await expect(page.locator('.fd-map')).toBeHidden();
    await expect(page.locator('[data-h-reset]')).toBeInViewport();
    await expect(page.locator('[data-h-exit]')).toBeInViewport();
    await expect(page.locator('.fd-fine')).toContainText('OpenStreetMap');
    await lean(page);
    await page.evaluate(startProbe);
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__hudProbe.frames >= 40, null, { timeout: 60_000, polling: 500 });
    await page.keyboard.up('ArrowUp');
    const st = await stopProbe(page);
    expect(st.seen).toBeGreaterThan(30);
    expect(st.under).toEqual([]);
    expect(st.maxCover).toBeLessThanOrEqual(0.12);
    // MORE brings the map and the chips back.
    await page.locator('.fd-hud [data-hud-toggle]').tap();
    expect(await mode(page)).toBe('full');
    await expect(page.locator('.fd-map')).toBeInViewport();
    await expect(page.locator('[data-h-cam]')).toBeInViewport();
    await page.close();
  });
}
