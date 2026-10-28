import { test, expect } from '@playwright/test';

// Ticket 0104: a flip phone in Chrome. Its tall inner screen upright (360×748) and sideways with the bars
// (800×300), and its cover screen (360×380 a Flip's, 424×360 a razr's; estimates, docs/backlog/0102). Both
// touch schemes, the run-up, the ledge and the air: every control a 44 px target, none under a HUD box or
// another control, nothing off the glass. scripts/hud-audit.mjs flies one-thumb at 3× through a whole run;
// this covers two thumbs too, at 1× (DOM only: the scene isn't drawn).
test.describe.configure({ mode: 'parallel' });

function layout() {
  const SEL = ['.top .brand', '.top-actions', '[data-cue]', '[data-hud-box]', '[data-stick]', '[data-stick-hint]', '.tbtn', '[data-onethumb]', '[data-hud-toggle]'];
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
  const name = (e) => e.dataset.hudBox || (e.dataset.cue !== undefined && 'cue') || String(e.className.baseVal ?? e.className);
  const overlaps = [], offscreen = [], small = [];
  for (let i = 0; i < els.length; i++) {
    const a = els[i].getBoundingClientRect();
    if (a.left < -1 || a.top < -1 || a.right > innerWidth + 1 || a.bottom > innerHeight + 1) offscreen.push(name(els[i]));
    if (els[i].matches('.tbtn, [data-onethumb], [data-stick]') && (a.width < 44 || a.height < 44)) small.push(`${name(els[i])} ${Math.round(a.width)}×${Math.round(a.height)}`);
    for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const b = els[j].getBoundingClientRect();
      const px = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (px > 2) overlaps.push(`${name(els[i])} × ${name(els[j])} ${Math.round(px)}`);
    }
  }
  return { overlaps, offscreen, small, n: els.length, hud: document.documentElement.dataset.hud };
}

const SIZES = [
  { width: 360, height: 748, full: true },    // the inner screen upright: room for every instrument
  { width: 800, height: 300, full: false },   // sideways with Chrome's bars: the compact line only
  { width: 360, height: 380, full: false },   // the cover screen (a Flip's)
  { width: 424, height: 360, full: false },   // the cover screen (a razr's)
];

for (const { full, ...vp } of SIZES) {
  test(`${vp.width}×${vp.height}: both touch schemes fit, every control a 44 px target`, async ({ browser }) => {
    test.slow();
    const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The full set asked for: where it has no room, the compact line shows instead (src/hud-mode.js fullFits).
    await page.addInitScript(() => { try { localStorage.setItem('coldgas_hud', 'full'); } catch { /* storage blocked */ } });
    await page.goto('/coldgas/?gfx=low');
    await page.waitForFunction(() => !!window.__coldgas?.stage && window.__coldgas.physicsReady(), null, { timeout: 60_000 });
    await page.evaluate(() => { window.__coldgas.stage.render = () => {}; });
    for (const scheme of ['thumb', 'classic']) {
      await page.evaluate((scheme) => {
        const G = window.__coldgas;
        G.touch.set('scheme', scheme); G.setTier('assist'); G.startRun('jump'); G.skipCountdown();
      }, scheme);
      await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 60_000 });
      for (const phase of ['ground', 'ramp', 'air']) {
        await page.evaluate((phase) => {
          window.__coldgas.S.paused = true;
          const t = document.querySelector('[data-touch]');
          t.dataset.phase = phase; t.toggleAttribute('data-ledge', phase === 'ramp');
          document.querySelector('.hud')?.toggleAttribute('data-air', phase === 'air');
        }, phase);
        await page.waitForTimeout(350);   // the HUD's own transitions
        const l = await page.evaluate(layout);
        const where = `${scheme} ${phase} (${l.hud})`;
        expect(l.n, where).toBeGreaterThan(3);   // the top bar, the band, a control, at least
        expect(l.hud, where).toBe(full ? 'full' : 'compact');
        expect(l.overlaps, where).toEqual([]);
        expect(l.offscreen, where).toEqual([]);
        expect(l.small, where).toEqual([]);
      }
      await page.evaluate(() => { window.__coldgas.S.paused = false; });
    }
    expect(errors).toEqual([]);
    await page.close();
  });
}
