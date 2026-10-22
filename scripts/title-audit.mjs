// The title at every viewport we ship to: no overlaps between the top bar and the title block,
// the CTA in view, the event cards in a tidy grid.
//   node scripts/title-audit.mjs <url> <outdir> [label]
import { chromium } from '@playwright/test';
import { launchOpts } from './launch.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', label = 'title'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VPS = [[1280, 720, 0], [1440, 900, 0], [1920, 1080, 0], [360, 780, 1], [390, 844, 1], [430, 932, 1], [844, 390, 1], [814, 380, 1],
  // iPads: mini, Air, Pro 12.9 (both ways) and Slide Over
  [768, 1024, 1], [1024, 768, 1], [820, 1180, 1], [1180, 820, 1], [1024, 1366, 1], [1366, 1024, 1], [320, 568, 1],
  // a notched phone's safe areas (see hud-audit.mjs)
  [390, 844, 1, { t: 47, r: 0, b: 34, l: 0 }], [844, 390, 1, { t: 0, r: 47, b: 21, l: 47 }]];
const browser = await chromium.launch(launchOpts());
let bad = 0;
for (const [w, h, touch, safe] of VPS) {
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  if (safe) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }),
    `:root { --safe-t: ${safe.t}px !important; --safe-r: ${safe.r}px !important; --safe-b: ${safe.b}px !important; --safe-l: ${safe.l}px !important; }`);
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30000 });
  await page.waitForTimeout(2200);
  const r = await page.evaluate(() => {
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
    const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 1 && b.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const top = [...document.querySelectorAll('.top .brand, .top-actions')].filter(vis).map(rect);
    const kids = [...document.querySelectorAll('.title > *')].filter(vis);
    const issues = [];
    for (const k of kids) {
      const a = rect(k);
      for (const t of top) if (a.x < t.r && a.r > t.x && a.y < t.b && a.b > t.y) issues.push(`${k.className || k.tagName} × top bar`);
      if (a.y < 0 || a.b > innerHeight + 1 || a.r > innerWidth + 1) issues.push(`${k.className || k.tagName} off screen`);
    }
    for (const el of document.querySelectorAll('.cta button')) if (vis(el)) { const a = rect(el); if (a.b > innerHeight || a.y < 0) issues.push('CTA out of view'); }
    const cards = [...document.querySelectorAll('.course-btn')].filter(vis).map(rect);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (a.x < b.r - 1 && a.r > b.x + 1 && a.y < b.b - 1 && a.b > b.y + 1) issues.push('cards overlap');
    }
    // No text under 11 px (invariant 8) on the title or the top bar.
    for (const root of document.querySelectorAll('.title, .top')) for (const el of [root, ...root.querySelectorAll('*')]) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !vis(el) || !el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11) issues.push(`"${el.textContent.trim().slice(0, 16)}" ${px}px`);
    }
    return issues;
  });
  const name = `${w}x${h}${safe ? '-safe' : ''}`;
  await page.screenshot({ path: `${out}/${label}-${name}.png` });
  bad += r.length;
  console.log(`${name}: ${r.length ? r.join('; ') : 'ok'}`);
  await page.close();
}
console.log(`TOTAL ${label}: ${bad} issues`);
await browser.close();
process.exitCode = bad ? 1 : 0;
