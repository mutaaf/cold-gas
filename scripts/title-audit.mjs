// The title at every viewport we ship to: no overlaps between the top bar and the title block,
// the CTA in view, the event cards in a tidy grid, no title text under 11 px. Phones (incl. a 320 px
// Slide Over column), iPads both ways, desktops, and a safe-area pass (`s`: a notched phone's insets
// forced on --safe-*, as in scripts/hud-audit.mjs), and a folding phone's poses as measured, each with its
// own insets (scripts/audit-plan.mjs FOLD, 0103), plus Safari's two windows side by side on its open screen.
//   node scripts/title-audit.mjs <url> <outdir> [label] [--only=WxH,WxH]
// A gate (0082): the exit code is 1 when any viewport has an issue, and the offenders are listed at
// the end. CI (software GL, about 2× slower): AUDIT_SLOW (default 2 when CI is set) scales the waits.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FOLD, FLIP, dprFor, insetCss } from './audit-plan.mjs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', label = 'title'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SLOW = Number(process.env.AUDIT_SLOW || (process.env.CI ? 2 : 1));
mkdirSync(out, { recursive: true });
const VPS = [[1280, 720, 0], [1440, 900, 0], [1920, 1080, 0], [390, 844, 1], [430, 932, 1], [768, 1024, 1], [844, 390, 1], [1024, 768, 1],
  [320, 568, 1], [814, 380, 1], [393, 659, 1], [820, 1180, 1], [1180, 820, 1], [1024, 1366, 1], [1366, 1024, 1],
  [390, 844, 1, 1], [844, 390, 1, 1], [932, 430, 1, 1],
  // The folding phone (0103): every measured pose, in a tab and installed, and one of two Safari windows
  // side by side on the open screen (WebKit's Safari 27.1 notes: 385×571).
  ...FOLD.map(([w, h]) => [w, h, 1]), [385, 571, 1],
  // A flip phone (0104): the tall inner screen both ways and the cover screens (estimates).
  ...FLIP.map(([w, h]) => [w, h, 1])];
// A GPU where there is one (macOS: Metal); software GL elsewhere (CI), as the e2e config does.
const GL = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });
let bad = 0;
const offenders = [];
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
for (const [w, h, touch, safe] of VPS) {
  if (only && !only.includes(`${w}x${h}${safe ? 's' : ''}`)) continue;
  const t0 = Date.now();
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: dprFor(w, h), isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  const forced = touch && insetCss(w, h, safe);
  if (forced) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }), forced);
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30000 * SLOW });
  // The title settles (its rise-in, the fonts): then nothing on it moves.
  await page.waitForTimeout(2200 * SLOW);
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
  if (r.length) offenders.push(`${name}: ${r.join('; ')}`);
  console.log(`${name}: ${r.length ? r.join('; ') : 'ok'} (${Math.round((Date.now() - t0) / 1000)} s)`);
  await page.close();
}
console.log(`TOTAL ${label}: ${bad} issues`);
if (bad) { console.log('FAIL — offenders:'); for (const o of offenders) console.log(`  ${o}`); process.exitCode = 1; }
await browser.close();
