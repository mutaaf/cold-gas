import { test, expect } from '@playwright/test';

// 0174: on the Show the sight's along-the-run dot glides onto its target when the slide can start to act along the run
// (`canA`), instead of jumping 14 px in one frame. A held one-thumb flight at 390×844, stepped in the page at 60 frames
// a second on a virtual clock (the pad's glide reads performance.now()), with the sight's target (`data-ey`) and the
// drawn dot (`data-ey-shown`, the transform) read every frame. COLDGAS_STRIP=<dir> also saves the pad, frame by frame,
// across the moment canA opens (the PR's frame strip).
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

test('on one thumb the sight\'s along-the-run dot glides in when canA opens, never more than 3 px a frame', async ({ browser }) => {
  test.slow();   // a whole one-thumb flight, stepped in the page
  const page = await browser.newPage(PHONE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/coldgas/?gfx=low&course=show');
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = window.__coldgas;
    g.stage.setPixelScale(0.5); g.stage.setPixelScale = () => {};
    g.touch.set('scheme', 'thumb'); g.touch.set('hand', 'right'); g.setTier('assist');
    g.startRun('jump'); g.skipCountdown();
  });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 60_000 });
  // Up the curl held, a tap on the ledge, held from the tap: stepped to the frame before the sight comes on.
  const frames = await page.evaluate(() => {
    const g = window.__coldgas, S = g.S, DT = 1 / 60;
    const real = performance.now.bind(performance);
    let clock = real();
    performance.now = () => clock;   // the pad's glide sees exactly 60 frames a second
    S.paused = true;
    const step = () => { clock += DT * 1000; g.liveStep(DT); };
    g.thumb.down();
    let tapped = false;
    for (let f = 0; f < 60 * 60 && S.mode === 'live' && S.run.phase !== 'air'; f++) {
      const cv = S.run.car.vel;
      if (!tapped && S.run.phase === 'ramp' && S.run.t.progress >= 0.92 && Math.hypot(cv.x, cv.y, cv.z) < 0.3) {
        g.thumb.up(); step(); g.thumb.down(); tapped = true;
      }
      step();
    }
    const aim = document.querySelector('[data-thumb-aim]'), mark = aim.querySelector('.ta-mark');
    const out = [];
    for (let f = 0; f < 60 * 20 && S.mode === 'live' && S.run.phase === 'air'; f++) {
      step();
      if (!aim.hasAttribute('data-on')) continue;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(mark.style.transform);
      out.push({ f, canA: g.thumb.canA, ey: Number(aim.dataset.ey), shown: Number(aim.dataset.eyShown), drawn: m ? Number(m[2]) : NaN });
    }
    performance.now = real;
    return out;
  });
  expect(frames.length, 'the sight was on in the air').toBeGreaterThan(20);
  const open = frames.findIndex((r) => r.canA);
  expect(open, 'canA opened while the sight was on').toBeGreaterThan(0);
  console.log('0174 frames around canA:', JSON.stringify(frames.slice(Math.max(0, open - 3), open + 20).map((r) => [r.f, r.canA ? 1 : 0, r.ey, r.drawn])));
  // The target jumps (what the critic measured); the drawn dot doesn't.
  expect(Math.abs(frames[open].ey - frames[open - 1].ey), 'the target jumps when canA opens').toBeGreaterThan(6);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (b.f !== a.f + 1) continue;   // the sight went out in between: it comes back on its target
    expect(b.drawn, `frame ${b.f}: data-ey-shown is what is drawn`).toBe(b.shown);
    expect(Math.abs(b.drawn - a.drawn), `frame ${b.f}: ${a.drawn} → ${b.drawn} (target ${b.ey})`).toBeLessThanOrEqual(3);
  }
  // And it is on the target within 0.25 s (15 frames) of the jump.
  const on = frames.slice(open).findIndex((r) => Math.abs(r.drawn - r.ey) <= 1);
  expect(on, 'on the target').toBeGreaterThanOrEqual(0);
  expect(on).toBeLessThanOrEqual(15);
  expect(errors).toEqual([]);

  // The frame strip (only when asked): fly it again and save the pad across the moment canA opens.
  const dir = process.env.COLDGAS_STRIP;
  if (dir) {
    const from = frames[open].f - 3;
    await page.evaluate(() => { const g = window.__coldgas; g.S.paused = false; g.startRun('jump'); g.skipCountdown(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live' && window.__coldgas.S.freezeT <= 0, null, { timeout: 60_000 });
    await page.evaluate(() => {
      const g = window.__coldgas, S = g.S, DT = 1 / 60;
      window.__real = performance.now.bind(performance);
      window.__clock = window.__real();
      performance.now = () => window.__clock;
      window.__step = () => { window.__clock += DT * 1000; g.liveStep(DT); };
      S.paused = true;
      g.thumb.down();
      let tapped = false;
      for (let f = 0; f < 60 * 60 && S.mode === 'live' && S.run.phase !== 'air'; f++) {
        const cv = S.run.car.vel;
        if (!tapped && S.run.phase === 'ramp' && S.run.t.progress >= 0.92 && Math.hypot(cv.x, cv.y, cv.z) < 0.3) {
          g.thumb.up(); window.__step(); g.thumb.down(); tapped = true;
        }
        window.__step();
      }
      document.querySelector('[data-onethumb]')?.classList.add('on');   // the held pad, as the player sees it
    });
    await page.evaluate((n) => { for (let f = 0; f < n; f++) window.__step(); }, from);
    const pad = page.locator('[data-onethumb]');
    for (let k = 0; k < 16; k++) {
      await page.evaluate(() => window.__step());
      await pad.screenshot({ path: `${dir}/strip-${String(k).padStart(2, '0')}.png`, animations: 'disabled' });
    }
  }
  await page.close();
});
