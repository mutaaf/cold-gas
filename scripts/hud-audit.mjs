// The HUD audit: flies the Show (by keyboard, so any build can be audited) at every viewport we
// ship to, freezes each phase, screenshots it, and measures what a designer would check by eye:
//   - overlaps between HUD instruments, touch controls, cues and bars (px² of intersection)
//   - the smallest rendered text (CSS px, SVG text scaled by its viewBox)
//   - WCAG contrast of every visible HUD label, measured on the real screenshot: the text's
//     luminance against the worst (closest) 10 % of the pixels behind it, with the text hidden.
//
//   node scripts/hud-audit.mjs <url> <outdir> [set=all|phones|quick] [label]
//
// Writes <outdir>/<label>-<viewport>-<phase>.png and <outdir>/<label>-report.json.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const [url = 'http://localhost:4391/coldgas/', out = 'shots', set = 'all', label = 'audit'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PHONES = [[390, 844], [430, 932], [844, 390], [932, 430]];
const TABLETS = [[768, 1024], [1024, 768]];
const DESKTOPS = [[1280, 720], [1920, 1080], [720, 1280], [1080, 1920]];
const VIEWPORTS = set === 'phones' ? PHONES : set === 'quick' ? [[390, 844], [844, 390], [1280, 720]] : /^\d+x\d+/.test(set) ? set.split(',').map((v) => v.split('x').map(Number)) : [...PHONES, ...TABLETS, ...DESKTOPS];
const touchFor = (w, h) => [...PHONES, ...TABLETS].some(([a, b]) => a === w && b === h);

// Everything that sits over the stage during a run (both the old markup and the new; missing ones
// are skipped). Pairs where one contains the other are not overlaps.
const BOXES = [
  '.top .brand', '.top-actions', '[data-drill-bar]', '[data-cue]',
  // old HUD
  '.hud-left', '.hud .speed', '.descent', '.hud .phase', '.adi-wrap', '.readouts',
  // new HUD
  '[data-hud-box]',
  // touch
  '[data-stick]', '.buttons', '[data-onethumb]', '[data-nozzle-pad] svg',
  // Free Drive
  '.fd-road', '.fd-ctl', '.fd-timer', '.fd-speed', '.fd-stats', '.fd-map', '.fd-fine',
];
const TEXT_ROOTS = '[data-screen="hud"], [data-touch], [data-cue], .top, [data-drill-bar], [data-drive-hud], [data-onethumb]';

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = [];

async function measure(page, vpName, phase) {
  const file = `${out}/${label}-${vpName}-${phase}.png`;
  // The sim is frozen, so the cue line's timer runs out and it fades; in play it is refreshed every
  // frame while it applies. Hold it on (no fade) so it is measured as a player sees it.
  await page.evaluate(() => { const c = document.querySelector('[data-cue]'); if (c?.textContent.trim()) { c.style.transition = 'none'; c.classList.add('on'); } });
  await page.waitForTimeout(450);   // let transitions settle
  const shot = await page.screenshot({ path: file });
  const m = await page.evaluate(({ BOXES, TEXT_ROOTS }) => {
    const vis = (el) => {
      if (!el || !el.isConnected) return false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
        if (e.hidden) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const boxes = [];
    for (const sel of BOXES) for (const el of document.querySelectorAll(sel)) if (vis(el)) {
      const r = el.getBoundingClientRect();
      boxes.push({ sel: el.dataset.hudBox ? `[data-hud-box=${el.dataset.hudBox}]` : sel, el, r: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.x + a.r.w, b.r.x + b.r.w) - Math.max(a.r.x, b.r.x);
      const h = Math.min(a.r.y + a.r.h, b.r.y + b.r.h) - Math.max(a.r.y, b.r.y);
      if (w > 1 && h > 1) overlaps.push({ a: a.sel, b: b.sel, px: Math.round(w * h) });
    }
    const offscreen = boxes.filter((b) => b.r.x < -1 || b.r.y < -1 || b.r.x + b.r.w > innerWidth + 1 || b.r.y + b.r.h > innerHeight + 1).map((b) => b.sel);
    // Text: every visible element with its own text.
    const texts = [];
    for (const root of document.querySelectorAll(TEXT_ROOTS)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own || !vis(el)) continue;
        const cs = getComputedStyle(el);
        let px = parseFloat(cs.fontSize);
        if (el instanceof SVGElement) { const ctm = el.getScreenCTM(); if (ctm) px *= Math.hypot(ctm.a, ctm.b); }
        const r = el.getBoundingClientRect();
        // effective opacity up the tree
        let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        const color = el instanceof SVGElement ? cs.fill : cs.color;
        texts.push({ t: el.textContent.trim().slice(0, 24), px: Math.round(px * 10) / 10, color, op, r: { x: r.x, y: r.y, w: r.width, h: r.height } });
      }
    }
    return { overlaps, offscreen, texts };
  }, { BOXES, TEXT_ROOTS });
  // Contrast: hide the HUD's text, screenshot the same frame (the sim is frozen), compare.
  await page.addStyleTag({ content: `${TEXT_ROOTS.split(', ').map((s) => `${s}, ${s} *`).join(', ')} { color: transparent !important; fill: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; }` }).then((h) => page.evaluate((el) => { el.id = 'audit-hide'; }, h));
  await page.waitForTimeout(80);
  const bare = await page.screenshot();
  await page.evaluate(() => document.getElementById('audit-hide')?.remove());
  const contrast = await page.evaluate(async ({ shotB64, bareB64, texts, dpr }) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
    const [img, bimg] = await Promise.all([load(shotB64), load(bareB64)]);
    const cv = new OffscreenCanvas(bimg.width, bimg.height), cx = cv.getContext('2d');
    cx.drawImage(bimg, 0, 0);
    const bg = cx.getImageData(0, 0, cv.width, cv.height).data;
    void img;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) || [255, 255, 255, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    return texts.map((t) => {
      const c = parse(t.color), a = c.a * t.op;
      // Inset 2 px: a box's own border is not the background behind its glyphs.
      const ins = Math.min(2, t.r.w / 4, t.r.h / 4);
      const x0 = Math.max(0, Math.floor((t.r.x + ins) * dpr)), y0 = Math.max(0, Math.floor((t.r.y + ins) * dpr));
      const x1 = Math.min(cv.width, Math.ceil((t.r.x + t.r.w - ins) * dpr)), y1 = Math.min(cv.height, Math.ceil((t.r.y + t.r.h - ins) * dpr));
      const ls = [];
      let worst = null;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * cv.width + x) * 4;
        // the text's own colour composited over this background pixel
        const tr = c.r * a + bg[i] * (1 - a), tg = c.g * a + bg[i + 1] * (1 - a), tb = c.b * a + bg[i + 2] * (1 - a);
        const lt = L(tr, tg, tb), lb = L(bg[i], bg[i + 1], bg[i + 2]);
        ls.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05));
      }
      if (!ls.length) return { ...t, ratio: null };
      ls.sort((p, q) => p - q);
      worst = ls[Math.floor(ls.length * 0.1)];   // the worst 10 % of the background behind it
      return { t: t.t, px: t.px, ratio: Math.round(worst * 100) / 100 };
    });
  }, { shotB64: shot.toString('base64'), bareB64: bare.toString('base64'), texts: m.texts, dpr: await page.evaluate(() => devicePixelRatio) });
  const small = m.texts.filter((t) => t.px < 11).map((t) => `${t.t} ${t.px}px`);
  const low = contrast.filter((c) => c.ratio !== null && c.ratio < 4.5).map((c) => `${c.t} ${c.ratio}`);
  const minPx = Math.min(...m.texts.map((t) => t.px));
  const minRatio = Math.min(...contrast.filter((c) => c.ratio !== null).map((c) => c.ratio));
  const row = { vp: vpName, phase, file, overlaps: m.overlaps, offscreen: m.offscreen, minPx, small, minRatio, lowContrast: low };
  report.push(row);
  console.log(`${vpName} ${phase}: overlaps ${m.overlaps.length}${m.overlaps.length ? ` (${m.overlaps.map((o) => `${o.a}×${o.b} ${o.px}`).join('; ')})` : ''} · offscreen ${m.offscreen.length} · min text ${minPx}px (${small.length} < 11) · min contrast ${minRatio} (${low.length} < 4.5)`);
}

for (const [w, h] of VIEWPORTS) {
  const touch = touchFor(w, h);
  const vpName = `${w}x${h}`;
  const page = await browser.newPage(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?gfx=low`);
  await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const S = (fn, arg) => page.evaluate(fn, arg);
  const freeze = () => S(() => { window.__coldgas.S.paused = true; });
  const thaw = () => S(() => { window.__coldgas.S.paused = false; const c = document.querySelector('[data-cue]'); if (c) c.style.transition = ''; });
  const until = (fn, timeout = 60000) => page.waitForFunction(fn, null, { timeout, polling: 'raf' }).then(() => true).catch(() => { console.log('  missed', fn.toString().slice(0, 90)); return false; });
  await S(() => { window.__auditStop = false; window.__coldgas.setTier('assist'); window.__coldgas.startRun('jump'); window.__coldgas.skipCountdown(); });
  // A page-side driver (synthetic key events, read by src/input.js like real ones): crawl in at
  // ≈5 m/s, up the curl, brake on the ledge (as scripts/human-show.mjs's players do).
  await S(() => {
    const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const st = { up: false, dn: false };
    const set = (k, on) => { if (st[k] !== on) { st[k] = on; key(k === 'up' ? 'ArrowUp' : 'ArrowDown', on); } };
    // One-thumb (the touch default on the Show): hold the pad; its governor stops on the ledge.
    const touchEl = document.querySelector('[data-touch]');
    const thumbOn = () => touchEl && !touchEl.hidden && touchEl.dataset.scheme === 'thumb';
    const drive = () => {
      const G = window.__coldgas.S, r = G.run;
      if (thumbOn()) {
        if (!r || G.mode !== 'live' || window.__auditStop) { window.__coldgas.thumb.up(); return; }
        if (!window.__coldgas.thumb.held) window.__coldgas.thumb.down();
        requestAnimationFrame(drive);
        return;
      }
      if (!r || G.mode !== 'live' || window.__auditStop) { set('up', false); set('dn', false); return; }
      if (!G.paused) {
        const v = Math.hypot(r.car.vel.x, r.car.vel.y, r.car.vel.z);
        // ease off near the top, stop on the ledge
        const ledge = r.phase === 'ramp' && (r.t.progress >= 0.95 || (r.t.progress > 0.85 && v > 2.5));
        set('up', !ledge && v < (r.phase === 'ramp' ? (r.t.progress > 0.85 ? 2 : 5) : 5.5));
        set('dn', ledge);
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });
  await until(() => window.__coldgas.S.run.car.pos.z > -5);
  await freeze(); await measure(page, vpName, '1-runup'); await thaw();
  await until(() => window.__coldgas.S.run.phase === 'ramp' && window.__coldgas.S.run.car.pos.y > 10);
  await freeze(); await measure(page, vpName, '2-climb'); await thaw();
  await until(() => { const r = window.__coldgas.S.run; return r.phase === 'ramp' && r.t.progress >= 0.95 && Math.hypot(r.car.vel.x, r.car.vel.y, r.car.vel.z) < 0.2; }, 60000);
  await S(() => { window.__auditStop = true; });
  await page.waitForTimeout(300);
  await freeze(); await measure(page, vpName, '3-hang'); await thaw();
  const thumbMode = await S(() => { const t = document.querySelector('[data-touch]'); return !!t && !t.hidden && t.dataset.scheme === 'thumb'; });
  if (thumbMode) await S(() => window.__coldgas.thumb.down());   // tap to let go, and keep holding: land
  else { await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.keyboard.up('Space'); }
  if (!thumbMode) { await page.keyboard.down('KeyF'); await page.keyboard.down('ShiftLeft'); }
  await until(() => window.__coldgas.S.run.phase === 'air' && window.__coldgas.S.run.car.pos.z < -9);
  await freeze(); await measure(page, vpName, '4-carry'); await thaw();
  await until(() => window.__coldgas.S.run.phase === 'air' && window.__coldgas.S.run.car.pos.y < 9);
  await freeze(); await measure(page, vpName, '5-brake'); await thaw();
  await until(() => window.__coldgas.S.run.t.touchTick >= 0, 30000);
  await page.waitForTimeout(200);
  await freeze(); await measure(page, vpName, '6-touchdown'); await thaw();
  if (thumbMode) await S(() => window.__coldgas.thumb.up()); else { await page.keyboard.up('KeyF'); await page.keyboard.up('ShiftLeft'); }
  await until(() => window.__coldgas.S.mode === 'results', 30000);
  // Free Drive on phones and the two desktop sizes.
  if (['390x844', '844x390', '1280x720', '1920x1080', '768x1024'].includes(vpName)) {
    await S(() => window.__coldgas.toTitle());
    await page.goto(`${url}?gfx=low&drive=stelvio`);
    const ok = await until(() => window.__coldgas?.drive?.active, 90000);
    if (ok) {
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(2500); await page.keyboard.up('ArrowUp');
      await S(() => window.__coldgas.drive.pause?.(false));
      await measure(page, vpName, '7-drive');
    }
  }
  if (errors.length) console.log('  errors:', errors.slice(0, 3).join(' | '));
  await page.close();
}
writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 1));
const tot = report.reduce((a, r) => ({ ov: a.ov + r.overlaps.length, sm: a.sm + r.small.length, lc: a.lc + r.lowContrast.length, off: a.off + r.offscreen.length }), { ov: 0, sm: 0, lc: 0, off: 0 });
console.log(`TOTAL ${label}: ${report.length} frames · overlaps ${tot.ov} · offscreen ${tot.off} · text < 11 px ${tot.sm} · labels < 4.5:1 ${tot.lc}`);
await browser.close();
