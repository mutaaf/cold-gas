// Thumb reach: where the touch controls sit against the thumbs' comfortable zones, per phone
// viewport, per scheme, per phase. Writes the geometry scripts/human-phone.mjs flies with
// (--geom=<out>/geom.json) and a heatmap screenshot per viewport: the right (and left) thumb's
// comfortable band shaded green → amber → red with distance, the controls outlined on top.
//
//   node scripts/thumb-reach.mjs <url> <outdir> [label=after]
//
// The band model (CSS px): portrait, one hand: the thumb pivots off the glass at (W + 30, H + 50);
// 200–380 px is comfortable, beyond 470 a regrip. Landscape, two hands: pivots at (−30, 0.8 H) and
// (W + 30, 0.8 H), 70–260 comfortable, 330 a stretch (Hoober 2013; Bergstrom-Lehtovirta &
// Oulasvirta 2014). The same constants live in human-phone.mjs.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', label = 'after'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VPS = [[390, 844], [430, 932], [844, 390], [932, 430]];
const geomFile = `${out}/geom.json`;
const geom = existsSync(geomFile) ? JSON.parse(readFileSync(geomFile, 'utf8')) : {};
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [w, h] of VPS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const hasThumb = await page.evaluate(() => !!document.querySelector('[data-onethumb]'));
  for (const scheme of hasThumb ? ['classic', 'thumb'] : ['classic']) {
    const rects = await page.evaluate((scheme) => {
      const G = window.__coldgas;
      G.touch?.set('scheme', scheme);
      G.setTier('assist'); G.startRun('jump'); G.skipCountdown(); G.S.paused = true;
      const t = document.querySelector('[data-touch]');
      t.hidden = false;
      const at = (phase, extra = {}) => {
        t.dataset.phase = phase;
        t.toggleAttribute('data-ledge', !!extra.ledge);
        const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 2 || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: Math.min(r.width, r.height) / 2 }; };
        return { stick: box('[data-stick]'), go: box('[data-btn-go]'), brake: box('[data-btn-brake]'), lift: box('[data-btn-lift]'), land: box('[data-btn-land]'), thumb: box('[data-onethumb]') };
      };
      const ground = at('ground'), ramp = at('ramp', { ledge: true }), air = at('air');
      return { ground, ramp, air };
    }, scheme);
    const c = {
      stick: rects.ground.stick, brake: rects.ground.brake, lift: rects.ramp.lift || rects.air.lift, go: rects.air.go || rects.ground.go, land: rects.air.land,
      thumb: rects.ground.thumb || rects.air.thumb, goGround: rects.ground.go,
    };
    for (const k of Object.keys(c)) if (!c[k]) delete c[k];
    geom[`${label}-${scheme}-${w}x${h}`] = { w, h, controls: c };
    // The heatmap, drawn over the live page (air phase: the busiest one).
    await page.evaluate(({ w, h }) => {
      const t = document.querySelector('[data-touch]');
      t.dataset.phase = 'air';
      const cv = document.createElement('canvas');
      cv.id = 'reach'; cv.width = w; cv.height = h;
      Object.assign(cv.style, { position: 'fixed', inset: '0', zIndex: '3', pointerEvents: 'none', opacity: '0.55' });
      const g = cv.getContext('2d');
      const portrait = h > w;
      const piv = portrait ? [[w + 30, h + 50]] : [[-30, h * 0.8], [w + 30, h * 0.8]];
      const band = portrait ? [200, 380, 470] : [70, 260, 330];
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        let best = 3;
        for (const [px, py] of piv) {
          const d = Math.hypot(x - px, y - py);
          const s = d >= band[0] && d <= band[1] ? 0 : d < band[0] ? Math.min(2, (band[0] - d) / 60) : d <= band[2] ? 1 + (d - band[1]) / (band[2] - band[1]) : 3;
          best = Math.min(best, s);
        }
        const i = (y * w + x) * 4;
        const col = best <= 0 ? [60, 200, 120] : best <= 1 ? [230, 190, 60] : best <= 2 ? [240, 120, 50] : [200, 50, 60];
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = best >= 3 ? 70 : 150;
      }
      g.putImageData(img, 0, 0);
      document.body.appendChild(cv);
    }, { w, h });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${label}-reach-${scheme}-${w}x${h}.png` });
    await page.evaluate(() => document.getElementById('reach')?.remove());
    console.log(`${label} ${scheme} ${w}x${h}:`, JSON.stringify(c));
  }
  await page.close();
}
writeFileSync(geomFile, JSON.stringify(geom, null, 1));
await browser.close();
