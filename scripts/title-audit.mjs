// The title at every viewport we ship to: no overlaps between the top bar and the title block,
// the CTA in view, the event cards in a tidy grid, no title text under 11 px. Phones (incl. a 320 px
// Slide Over column), iPads both ways, desktops, and a safe-area pass (`s`: a notched phone's insets
// forced on --safe-*, as in scripts/hud-audit.mjs), and a folding phone's poses (0075).
//   node scripts/title-audit.mjs <url> <outdir> [label]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', label = 'title'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VPS = [[1280, 720, 0], [1440, 900, 0], [1920, 1080, 0], [390, 844, 1], [430, 932, 1], [768, 1024, 1], [844, 390, 1], [1024, 768, 1],
  [320, 568, 1], [814, 380, 1], [393, 659, 1], [820, 1180, 1], [1180, 820, 1], [1024, 1366, 1], [1366, 1024, 1],
  [390, 844, 1, 1], [844, 390, 1, 1], [932, 430, 1, 1],
  // A folding phone in its browser (0075): closed upright and sideways, open upright and sideways, and
  // the size it passes through mid-swing.
  [382, 580, 1], [678, 340, 1], [669, 825, 1], [951, 543, 1], [466, 498, 1]];
const insetCss = (w, h) => (w > h
  ? ':root { --safe-t: 0px !important; --safe-l: 47px !important; --safe-r: 47px !important; --safe-b: 21px !important; }'
  : ':root { --safe-t: 47px !important; --safe-l: 0px !important; --safe-r: 0px !important; --safe-b: 34px !important; }');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const [w, h, touch, safe] of VPS) {
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  if (safe) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }), insetCss(w, h));
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
    // Every visible piece of title text (and the top bar) at 11 px or more.
    for (const el of document.querySelectorAll('.title *, .top *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      let ok = true;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (!vis(e) || e.hidden) { ok = false; break; }
      if (!ok) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11) issues.push(`"${el.textContent.trim().slice(0, 18)}" ${px}px`);
    }
    for (const t of top) if (t.x < -1 || t.r > innerWidth + 1) issues.push('top bar off screen');
    return issues;
  });
  const name = `${w}x${h}${safe ? 's' : ''}`;
  await page.screenshot({ path: `${out}/${label}-${name}.png` });
  bad += r.length;
  console.log(`${name}: ${r.length ? r.join('; ') : 'ok'}`);
  await page.close();
}
console.log(`TOTAL ${label}: ${bad} issues`);
await browser.close();
