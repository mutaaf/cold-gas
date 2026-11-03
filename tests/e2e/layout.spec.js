import { test, expect } from '@playwright/test';

// The layout floor at the edges of what we ship to (tickets 0033, 0047): the landscape phone's top
// bar and mission block, a 320 px Slide Over column, the iPad title, the desktop keyboard hints,
// and fields that don't make iOS zoom. scripts/hud-audit.mjs and scripts/title-audit.mjs measure
// the whole matrix on screenshots; these are the cheap guards that run on every PR.
const touch = (width, height) => ({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const boot = async (page, q = '') => {
  await page.goto(`/coldgas/?gfx=low${q}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
};
const rect = (page, sel) => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}, sel);
const apart = (a, b) => a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1;

test('phone landscape: the mission block sits clear of Home and Retry during the Show', async ({ browser }) => {
  test.slow();   // waits on the title's software-GL frames before the run starts
  const page = await browser.newPage(touch(844, 390));
  await boot(page);
  await page.evaluate(async () => { await window.__coldgas.physicsReady; window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 30_000 });
  await expect(page.locator('.quick-home')).toBeVisible();
  await expect(page.locator('.tier-chip')).toBeHidden();   // title settings step aside mid-run
  const mission = await rect(page, '[data-hud-box="mission"]'), actions = await rect(page, '.top-actions');
  expect(apart(mission, actions), JSON.stringify({ mission, actions })).toBe(true);
  for (const box of [mission, actions]) expect(box.r).toBeLessThanOrEqual(844);
  await page.close();
});

// 0131: the share of the roadster's projected box (every visible hero mesh's bounding box through the camera) that is
// on screen and outside every title text, button and card box, sampled on a 24 × 24 grid.
const heroClear = (page) => page.evaluate(() => {
  const g = window.__coldgas, cam = g.camera, W = innerWidth, H = innerHeight, c = g.hero.group.position.clone();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  g.hero.group.updateMatrixWorld(true);
  g.hero.group.traverseVisible((o) => {
    const bb = o.isMesh && !o.isInstancedMesh && o.geometry && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox));
    if (!bb) return;
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
      const px = (c.x + 1) / 2 * W, py = (1 - c.y) / 2 * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  });
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const boxes = [...document.querySelectorAll('[data-screen="title"] *')]
    .filter((e) => e.matches('button, a, .xc') || own(e))
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  let free = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / 24, y = y0 + (y1 - y0) * (j + 0.5) / 24;
    if (x >= 0 && y >= 0 && x <= W && y <= H && !boxes.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) free++;
  }
  return { free: free / 576, box: [x0, y0, x1, y1].map(Math.round), band: document.querySelector('[data-screen="title"]').dataset.carBand || '' };
});

test('320 px column: the top bar and the title fit, nothing under the bar; on a phone the car shows beside the title', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(touch(320, 568));
  await boot(page);
  await page.waitForTimeout(1300);   // the title's rise-in
  const actions = await rect(page, '.top-actions'), wordmark = await rect(page, '.wordmark'), cta = await rect(page, '[data-start]');
  expect(actions.x).toBeGreaterThanOrEqual(0);
  expect(actions.r).toBeLessThanOrEqual(320);
  expect(apart(actions, wordmark), JSON.stringify({ actions, wordmark })).toBe(true);
  expect(cta.b).toBeLessThanOrEqual(568);
  // 0131: the title's panel filled an upright phone and the turntable's car stood behind the Daily card. Now ≥ 60 % of
  // its box is clear of every title box at the phone sizes the ticket names (the same page, resized: the lens refits).
  for (const [w, h] of [[390, 844], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1500);
    const m = await heroClear(page);
    expect(m.free, `${w}×${h} ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0.6);
    expect(m.band, `${w}×${h}`).toBe('below');
  }
  await page.close();
});

test('iPad title: the spec labels are 11 px or more', async ({ browser }) => {
  const page = await browser.newPage(touch(1024, 1366));
  await boot(page);
  await expect(page.locator('.spec')).toBeVisible();
  const sizes = await page.$$eval('.spec dt', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11);
  await page.close();
});

test('desktop: the Home, Retry and Pause key hints are 11 px or more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, '&play=jump');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'countdown' || window.__coldgas?.S.mode === 'live', null, { timeout: 60_000 });
  const sizes = await page.$$eval('.quick kbd', (els) => els.filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBe(3);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11);
});

test('touch: every field is 16 px or more (iOS zooms into anything smaller) and taps do not flash', async ({ browser }) => {
  const page = await browser.newPage(touch(390, 844));
  await boot(page);
  const r = await page.evaluate(() => {
    // The lazily built sheets (AI key, Sandbox save, quest wish, endless seed) style their fields
    // with selectors like these; the same global floor has to win over them.
    const host = document.createElement('div');
    host.className = 'ai-field';
    host.innerHTML = '<input type="text"><select><option>a</option></select><textarea></textarea>';
    document.body.append(host);
    const sizes = [...document.querySelectorAll('input, select, textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize));
    const tap = getComputedStyle(document.querySelector('[data-start]')).webkitTapHighlightColor;
    host.remove();
    return { sizes, tap };
  });
  expect(r.sizes.length).toBeGreaterThan(3);
  for (const px of r.sizes) expect(px).toBeGreaterThanOrEqual(16);
  expect(r.tap).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await page.close();
});

test('first paint: the mono face is preloaded with the display and text faces', async ({ page }) => {
  const res = await page.goto('/coldgas/?gfx=low');
  const html = await res.text();
  expect(html).toMatch(/<link rel="preload" href="\/coldgas\/assets\/geist-mono-latin-400-normal-[\w-]+\.woff2" as="font"/);
  expect(html).toMatch(/michroma-latin-400-normal/);
});
