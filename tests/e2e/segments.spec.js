import { test, expect } from '@playwright/test';

// Ticket 0105: a foldable that reports its hinge (Chromium's Viewport Segments and Device Posture, emulated
// over the DevTools protocol: a display feature on setDeviceMetricsOverride, setDevicePostureOverride).
// Half-folded with the fold across the screen (a flip phone on a table) the scene is drawn above the fold and
// nothing the eyes or thumbs work with sits on it; with the fold down the middle (a book fold half-open) the
// sheets keep to one side. Opening flat again puts everything back, in the same run.
// (Re-sending the same override is a no-op, and Playwright's own screenshot resets it: no screenshots here.)
test.describe.configure({ mode: 'parallel' });

const crossing = ([kind, a, b]) => {
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  // Every control and HUD box, and every piece of text: none may lie across the hinge's band.
  const els = [...document.querySelectorAll('button, [data-hud-box], [data-cue], [data-stick], .tbtn, [data-onethumb], h1, h2, h3, p, li, dd, dt, b, span')].filter(vis)
    .filter((e) => e.matches('button, [data-hud-box], [data-cue], [data-stick], .tbtn, [data-onethumb]') || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  return els.filter((e) => {
    const r = e.getBoundingClientRect();
    const [lo, hi] = kind === 'rows' ? [r.top, r.bottom] : [r.left, r.right];
    return hi > a + 1 && lo < b - 1;
  }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className.baseVal ?? e.className).split(' ')[0]} "${e.textContent.trim().slice(0, 20)}"`);
};

async function setup(browser, vp, kind, offset, mask) {
  const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/**', (r) => r.abort());   // the panel speaks from local lines
  await page.goto('/coldgas/?gfx=low');
  await page.waitForFunction(() => !!window.__coldgas?.stage && window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  const metrics = (feature) => cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true, ...(feature ? { displayFeature: feature } : {}) });
  const fold = async () => {
    await metrics({ orientation: kind === 'rows' ? 'horizontal' : 'vertical', offset, maskLength: mask });
    await cdp.send('Emulation.setDevicePostureOverride', { posture: { type: 'folded' } });
    await page.waitForFunction((k) => document.documentElement.dataset.fold === k, kind, { timeout: 5_000 });
  };
  const flat = async () => {
    await metrics(null);
    await cdp.send('Emulation.setDevicePostureOverride', { posture: { type: 'continuous' } });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-fold'), null, { timeout: 5_000 });
  };
  const band = [kind, offset, offset + mask];
  const across = async (where) => { await page.waitForTimeout(300); expect(await page.evaluate(crossing, band), where).toEqual([]); };
  return { page, errors, fold, flat, across };
}

test('a flip phone half-folded (360×748, the fold across): the scene above, nothing on the fold, back in the same run', async ({ browser }) => {
  test.slow();
  const vp = { width: 360, height: 748 }, A = 366, M = 16;
  const { page, errors, fold, flat, across } = await setup(browser, vp, 'rows', A, M);
  await fold();
  // The canvas (and the camera) take the top segment.
  expect(await page.evaluate(() => [document.getElementById('stage').getBoundingClientRect().height, window.__coldgas.camera.aspect])).toEqual([A, vp.width / A]);
  await across('title');
  // The reference flight, stepped in the page: through the air the car's centre stays in the top segment
  // (the canvas), and the descent, the cue and the pad stay off the fold.
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  const r = await page.evaluate(() => {
    const G = window.__coldgas, cam = G.camera, v = G.carRoot.position.clone();
    G.S.paused = true; G.stage.render = () => {};
    let air = 0, out = 0;
    for (let f = 0; f < 30 * 40 && G.S.mode === 'live' && G.S.run.phase !== 'done'; f++) {
      G.liveStep(1 / 30); G.S.time += 1 / 30;
      G.director.update(1 / 30, G.S.time, { carPos: G.carRoot.position, carVel: G.S.run.car.vel, phase: G.S.run.phase, mode: 'live', course: G.stage.course });
      cam.updateMatrixWorld(true);
      if (G.S.run.phase !== 'air' || G.carRoot.position.y < 1) continue;
      air++;
      v.copy(G.carRoot.position).project(cam);
      if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) out++;
      if (air === 20) break;   // mid-air: measure the HUD here
    }
    return { air, out };
  });
  expect(r.air).toBeGreaterThan(10);
  expect(r.out).toBe(0);
  await across('in the air');
  // The pause sheet (as a phone pauses: the tab goes hidden) sits under the fold.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await across('paused');
  // Opened flat: the canvas and the camera take the whole screen again; the same run, no reload.
  const run = await page.evaluate(() => { window.__run = window.__coldgas.S.run; return !!window.__run; });
  expect(run).toBe(true);
  await flat();
  await page.waitForFunction(() => document.getElementById('stage').getBoundingClientRect().height === innerHeight, null, { timeout: 5_000 });
  expect(await page.evaluate(() => [window.__coldgas.S.run === window.__run, window.__coldgas.camera.aspect])).toEqual([true, vp.width / vp.height]);
  expect(errors).toEqual([]);
  await page.close();
});

test('a book fold half-open (744×780, the fold down the middle): the title, the run, the pause sheet and the results keep off it', async ({ browser }) => {
  test.slow();
  const vp = { width: 744, height: 780 };
  const { page, errors, fold, across } = await setup(browser, vp, 'cols', 364, 16);
  await fold();
  await across('title');
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
  await across('run');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  await expect(page.locator('[data-screen="pause"]')).toBeVisible();
  await across('paused');
  await page.locator('[data-resume]').click();
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  await across('the judges\' theatre');
  await page.waitForFunction(() => document.querySelectorAll('[data-r-judges] li').length > 0, null, { timeout: 30_000 });
  await page.evaluate(() => document.querySelector('[data-theatre] .th-skip')?.click());
  await page.waitForFunction(() => !document.querySelector('[data-theatre]') || document.querySelector('[data-theatre]').hidden || getComputedStyle(document.querySelector('[data-theatre]')).display === 'none', null, { timeout: 15_000 }).catch(() => {});
  await across('results');
  expect(errors).toEqual([]);
  await page.close();
});
