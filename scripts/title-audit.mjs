// The title at every viewport we ship to: no overlaps between the top bar and the title block,
// the CTA in view, the event cards in a tidy grid.
//   node scripts/title-audit.mjs <url> <outdir> [label]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', label = 'title'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VPS = [[1280, 720, 0], [1440, 900, 0], [1920, 1080, 0], [390, 844, 1], [430, 932, 1], [768, 1024, 1], [844, 390, 1], [1024, 768, 1]];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const [w, h, touch] of VPS) {
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
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
    return issues;
  });
  await page.screenshot({ path: `${out}/${label}-${w}x${h}.png` });
  bad += r.length;
  console.log(`${w}x${h}: ${r.length ? r.join('; ') : 'ok'}`);
  await page.close();
}
console.log(`TOTAL ${label}: ${bad} issues`);
await browser.close();
