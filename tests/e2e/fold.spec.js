import { test, expect } from '@playwright/test';

// Ticket 0075: a folding phone. Its browser gives a page 382×580 closed upright, 678×340 closed
// sideways, 669×825 open upright and 951×543 open sideways, and a fold or an unfold is only a resize
// (no reload), passing through 466×498 mid-swing. These pages are touch at 1× (the device is 3×; 1×
// keeps CI's software GL fast, and nothing here depends on the pixel ratio: the buffer check reads
// the renderer's own ratio). scripts/hud-audit.mjs and scripts/title-audit.mjs fly the same sizes at 3×.
test.describe.configure({ mode: 'parallel' });
const CLOSED = { width: 382, height: 580 }, CLOSED_SIDE = { width: 678, height: 340 };
const OPEN = { width: 669, height: 825 }, OPEN_SIDE = { width: 951, height: 543 };
const SWING = { width: 466, height: 498 };
const touch = (viewport) => ({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const boot = async (page, q = '') => {
  await page.goto(`/coldgas/?gfx=low${q}`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
};
// (physicsReady is a function: wait on it, docs/LESSONS.md.)
const physics = (page) => page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });

// Everything over the stage in a run (as scripts/hud-audit.mjs counts it): visible boxes, the pairs
// that overlap (one inside the other is not an overlap), and any box past the viewport's edges.
function layout() {
  const SEL = ['.top .brand', '.top-actions', '[data-drill-bar]', '[data-cue]', '[data-hud-box]', '[data-stick]', '.tbtn', '[data-onethumb]', '[data-hud-toggle]'];
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const els = SEL.flatMap((s) => [...document.querySelectorAll(s)]).filter(vis);
  const name = (e) => e.dataset.hudBox || e.dataset.cue !== undefined && 'cue' || e.className.baseVal || e.className || e.tagName;
  const overlaps = [], offscreen = [];
  for (let i = 0; i < els.length; i++) {
    const a = els[i].getBoundingClientRect();
    if (a.left < -1 || a.top < -1 || a.right > innerWidth + 1 || a.bottom > innerHeight + 1) offscreen.push(`${name(els[i])} ${Math.round(a.left)},${Math.round(a.top)},${Math.round(a.right)},${Math.round(a.bottom)}`);
    for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const b = els[j].getBoundingClientRect();
      const px = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (px > 2) overlaps.push(`${name(els[i])} × ${name(els[j])} ${Math.round(px)}`);
    }
  }
  return { overlaps, offscreen, n: els.length };
}

// The drawing buffer fitted to the canvas (three sizes it to floor(css × ratio)) once the size has
// settled: 150 ms on a phone, but on CI's software GL one frame of a big run can take longer than
// that, and the settle's timer waits behind it. The proportions are right from the first frame (the
// camera check above), so the wait only bounds how long the softer, scaled frames last.
const fitted = (page, { width, height }) => page.waitForFunction(({ width, height }) => {
  const { renderer } = window.__coldgas.stage, c = renderer.domElement, pr = renderer.getPixelRatio();
  return Math.abs(c.width - Math.floor(width * pr)) <= 1 && Math.abs(c.height - Math.floor(height * pr)) <= 1;
}, { width, height }, { timeout: 10_000, polling: 50 });

for (const [from, to] of [[CLOSED, OPEN], [CLOSED_SIDE, OPEN_SIDE]]) {
  test(`a fold mid-run: ${from.width}×${from.height} → ${SWING.width}×${SWING.height} → ${to.width}×${to.height} and back, the same run carries on`, async ({ browser }) => {
    test.slow();   // a run on software GL
    const page = await browser.newPage(touch(from));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page);
    await physics(page);
    await page.evaluate(() => {
      window.__foldMarker = 'still here';   // a reload would lose it
      const s = window.__coldgas.stage;
      s.setPixelScale = () => {};           // the resolution governor's steps would resize the buffer too
      window.__fits = 0;                    // drawing-buffer reallocations
      window.__fitSizes = [];               // the CSS sizes the buffer was fitted to
      const setSize = s.renderer.setSize.bind(s.renderer);
      s.renderer.setSize = (w, h, u) => { window.__fits++; window.__fitSizes.push(`${w}x${h}`); return setSize(w, h, u); };
      window.__resizes = [];                // when each size arrived
      addEventListener('resize', () => window.__resizes.push([`${innerWidth}x${innerHeight}`, performance.now()]));
      window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown();
    });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
    await page.evaluate(() => { window.__run = window.__coldgas.S.run; });
    for (const [mid, end] of [[SWING, to], [SWING, from]]) {
      const before = await page.evaluate(() => { window.__resizes.length = 0; window.__fitSizes.length = 0; return { tick: window.__coldgas.S.run.tick, fits: window.__fits }; });
      await page.setViewportSize(mid);
      await page.waitForTimeout(40);   // a frame or two at the swing's size
      // Mid-swing the camera already has the new shape (no stretched frame), the buffer waits.
      expect(await page.evaluate(({ width, height }) => Math.abs(window.__coldgas.camera.aspect - width / height) < 1e-6, mid)).toBe(true);
      await page.setViewportSize(end);
      expect(await page.evaluate(({ width, height }) => Math.abs(window.__coldgas.camera.aspect - width / height) < 1e-6, end)).toBe(true);
      await fitted(page, end);
      const after = await page.evaluate(() => ({
        marker: window.__foldMarker, same: window.__coldgas.S.run === window.__run, mode: window.__coldgas.S.mode,
        tick: window.__coldgas.S.run.tick, fits: window.__fits, sizes: window.__fitSizes.slice(), resizes: window.__resizes.slice(),
      }));
      expect(after.marker).toBe('still here');
      expect(after.same).toBe(true);
      expect(after.mode).toBe('live');
      // The run kept going (the clock runs on through the fold).
      await page.waitForFunction((t) => window.__coldgas.S.run.tick > t, after.tick, { timeout: 10_000 });
      expect(after.tick).toBeGreaterThan(before.tick);
      // The buffer ends fitted to the pose. And the size no pose has never got a buffer of its own
      // when it passed quicker than the settle (150 ms; a busy runner can take longer between the two
      // viewport calls, and then it is a real size for a moment and may be fitted).
      expect(after.sizes.at(-1)).toBe(`${end.width}x${end.height}`);
      const swing = after.resizes.find(([s]) => s === `${mid.width}x${mid.height}`), next = after.resizes.find(([s]) => s === `${end.width}x${end.height}`);
      if (swing && next && next[1] - swing[1] < 120) {
        expect(after.sizes, JSON.stringify(after.resizes)).not.toContain(`${mid.width}x${mid.height}`);
        expect(after.fits - before.fits).toBe(1);
      }
      await page.waitForTimeout(400);   // the HUD's own settle (src/hud-mode.js refit)
      const l = await page.evaluate(layout);
      expect(l.n).toBeGreaterThan(3);
      expect(l.overlaps, l.overlaps.join('; ')).toEqual([]);
      expect(l.offscreen, l.offscreen.join('; ')).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.close();
  });
}

// The title and the results: two even columns open, one closed, nothing past the edges.
const columns = (page, sel) => page.evaluate((sel) => {
  const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1; };
  const kids = [...document.querySelector(sel).children].filter(vis);
  // 8 px buckets; on a phone the results' action bar is full-bleed by design (pinned under the thumb).
  const lefts = [...new Set(kids.filter((e) => !e.matches('.top-actions-row')).map((e) => Math.round(e.getBoundingClientRect().left / 8)))];
  const off = kids.filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map((e) => e.className);
  return { cols: lefts.length, off, n: kids.length };
}, sel);

for (const [vp, want] of [[CLOSED, 1], [CLOSED_SIDE, 1], [OPEN, 2], [OPEN_SIDE, 2]]) {
  test(`${vp.width}×${vp.height}: the title and the results in ${want} column${want > 1 ? 's' : ''}, all in view`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage(touch(vp));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/coldgas/api/**', (r) => r.abort());   // the panel speaks from local lines
    await boot(page);
    await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });   // DOM only from here
    await page.waitForTimeout(1300);   // the title's rise-in
    const title = await columns(page, '.title');
    expect(title.cols, JSON.stringify(title)).toBe(want);
    expect(title.off).toEqual([]);
    const inView = await page.evaluate(() => [...document.querySelectorAll('.title > *, .title .course-btn, .title .cta .btn')]
      .filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; })
      .map((e) => e.className || e.tagName));
    expect(inView).toEqual([]);
    await physics(page);
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); window.__coldgas.fastForward(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-r-judges] li').length > 0, null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('.results .sheet').getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10_000 });   // the sheet's slide-in
    const results = await columns(page, '.results .sheet');
    expect(results.cols, JSON.stringify(results)).toBe(want);
    expect(results.off).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
}

// Chromium's Viewport Segments (a foldable that reports its hinge, emulated over the DevTools
// protocol): the band, the phase tab and the cue line stay off a vertical fold. Without segments
// (every test above) none of it applies.
test('a reported fold: the band, the phase and the cue line keep off the hinge', async ({ browser }) => {
  test.slow();
  const page = await browser.newPage(touch({ width: 900, height: 600 }));
  const cdp = await page.context().newCDPSession(page);
  await boot(page);
  expect(await page.evaluate(() => matchMedia('(horizontal-viewport-segments: 2)').matches)).toBe(false);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: true, displayFeature: { orientation: 'vertical', offset: 440, maskLength: 20 } });
  await page.waitForFunction(() => matchMedia('(horizontal-viewport-segments: 2)').matches, null, { timeout: 5_000 });
  await physics(page);
  await page.evaluate(() => { window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && document.querySelector('[data-cue]')?.textContent, null, { timeout: 60_000 });
  const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-cue], [data-hud-box="mission"], [data-hud-box="strip"]')]
    .map((e) => { const r = e.getBoundingClientRect(); return { k: e.dataset.hudBox || 'cue', l: r.left, r: r.right, w: r.width }; }));
  expect(boxes.length).toBe(3);
  for (const b of boxes) {
    expect(b.w, JSON.stringify(b)).toBeGreaterThan(100);
    expect(b.r <= 440 || b.l >= 460, JSON.stringify(b)).toBe(true);
  }
  await page.close();
});
