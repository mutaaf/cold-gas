// How much of the scene the HUD covers (0112). The HUD audit checks that the instruments don't overlap each
// other or leave the glass; this measures what they take from the picture: during a live run (the Show's run-up,
// the reference in the air) and in Free Drive, at every touch size, with both touch schemes.
//
//   node scripts/hud-cover.mjs <url> [outdir] [set=WxH[s|p],…|cover] [schemes=thumb,classic] [--gate] [--shots]
//
// Per frame:
//   - cover %: the share of the viewport under painted HUD chrome, as a union on a 4 px grid. Painted = a
//     background with alpha ≥ 0.08, a backdrop filter, a visible border, an SVG/canvas/img, or a line of text
//     (its glyph boxes): anything a player sees instead of the scene. Touch controls and the cue line count.
//   - tint %: the share under a gradient scrim only (it darkens the scene behind the band, it doesn't hide it).
//   - solid %: the same for chrome at least half opaque (a background alpha ≥ 0.5): what hides the scene outright.
//   - car %: how much of the car's screen box (its 3D bounds projected) is under chrome; ahead %: how much of a
//     box on the road 25 m ahead of it (the track you steer for) is.
// A trailing `p` on a size is the installed app (0112): navigator.standalone set (Chromium can't emulate display-mode)
// and the fold's measured insets forced, as on the device's home-screen app.
// --gate exits 1 when a frame's cover % passes the ceiling (scripts/audit-plan.mjs coverCeiling) or the car is more than a
// quarter covered.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { insetCss, dprFor, measureCover, COVER_ROOTS as ROOTS, coverCeiling } from './audit-plan.mjs';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const [url = 'http://127.0.0.1:4655/coldgas/', out = 'cover-shots', set = 'cover', schemesArg = 'thumb,classic'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// The sizes the operator plays on: a phone both ways, the book fold (installed and in a tab), the flip's cover
// and tall screens (0110), an iPad both ways.
const COVER = ['390x844', '844x390', '669x930p', '951x648p', '466x657p', '678x445p', '669x871', '951x589', '382x580', '594x368', '360x380', '424x360', '800x300', '820x1180', '1180x820'];
const SIZES = (set === 'cover' ? COVER : set.split(',')).map((s) => { const m = s.match(/^(\d+)x(\d+)([sp]?)$/); return { name: s, w: +m[1], h: +m[2], pwa: m[3] === 'p', safe: m[3] === 's' }; });
const SCHEMES = schemesArg.split(',');
mkdirSync(out, { recursive: true });
const GL = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });

// A few of the page's own frames, live (the camera and the car drawn where the sim has them), then frozen.
async function settle(page) {
  await page.evaluate(() => { window.__coldgas.S.paused = false; });
  await page.waitForTimeout(350);
  await page.evaluate(() => { window.__coldgas.S.paused = true; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}

async function frame(page, name, rows) {
  const r = await page.evaluate(({ ROOTS, src }) => {
    const m = new Function(`return (${src})`)()(ROOTS);
    const g = window.__coldgas, cam = g.camera, car = g.carRoot;
    const pct = (grid) => grid.reduce((a, v) => a + v, 0) / grid.length;
    // The car's screen box: its world bounds' corners projected; the road ahead: 25 m along its heading.
    const box = (pts) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, front = false;
      for (const p of pts) { const v = p.clone().project(cam); if (v.z < 1) front = true; const sx = (v.x + 1) / 2 * m.W, sy = (1 - v.y) / 2 * m.H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
      return front ? { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(m.W, x1), y1: Math.min(m.H, y1) } : null;
    };
    const under = (b) => { if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) return null; let n = 0, t = 0; for (let y = Math.floor(b.y0 / m.C); y < Math.ceil(b.y1 / m.C); y++) for (let x = Math.floor(b.x0 / m.C); x < Math.ceil(b.x1 / m.C); x++) { t++; n += m.any[y * m.cols + x] || 0; } return t ? n / t : null; };
    car.updateMatrixWorld(true);
    const V = car.position.constructor;
    const c = new V(); car.getWorldPosition(c);
    const corners = [];
    for (const dx of [-1, 1]) for (const dy of [0, 1.3]) for (const dz of [-2.3, 2.3]) corners.push(new V(dx, dy, dz).applyMatrix4(car.matrixWorld));
    const fwd = new V(0, 0, 1).transformDirection(car.matrixWorld); fwd.y = 0; fwd.normalize();
    // Which way is forward on this car model: the one pointing away from the camera.
    const toCam = cam.position.clone().sub(c); toCam.y = 0;
    if (fwd.dot(toCam) > 0) fwd.multiplyScalar(-1);
    const a = c.clone().addScaledVector(fwd, 25), side = new V(fwd.z, 0, -fwd.x);
    const ahead = [];
    for (const s of [-4, 4]) for (const h of [0, 2]) ahead.push(a.clone().addScaledVector(side, s).add(new V(0, h, 0)));
    return { cover: pct(m.any), solid: pct(m.solid), tint: pct(m.tint), car: under(box(corners)), ahead: under(box(ahead)), who: m.who, safe: getComputedStyle(document.documentElement).getPropertyValue('--safe-t').trim(), standalone: document.documentElement.hasAttribute('data-installed'), stage: (() => { const s = document.getElementById('stage').getBoundingClientRect(); return `${Math.round(s.width)}x${Math.round(s.height)}`; })() };
  }, { ROOTS, src: measureCover.toString() });
  if (flags.shots) await page.screenshot({ path: `${out}/${name}.png` });
  const f = (v) => (v == null ? '  —' : `${(v * 100).toFixed(0).padStart(3)}%`);
  console.log(`${name.padEnd(34)} cover ${f(r.cover)} · solid ${f(r.solid)} · tint ${f(r.tint)} · car ${f(r.car)} · ahead ${f(r.ahead)} · stage ${r.stage}${r.standalone ? ' (standalone)' : ''} · ${r.who.join(', ')}`);
  rows.push({ name, ...r });
}

const rows = [];
for (const vp of SIZES) for (const scheme of SCHEMES) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dprFor(vp.w, vp.h), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // Installed: Chromium's DevTools protocol can't emulate display-mode, so iOS's own flag stands in (index.html reads both).
  if (vp.pwa) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }));
  await page.addInitScript(() => { window.touchNow = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: 1, clientY: 1 })); });
  await page.addInitScript((s) => { try { localStorage.setItem('coldgas_touch', JSON.stringify({ scheme: s })); localStorage.removeItem('coldgas_hud'); } catch { /* blocked */ } }, scheme);
  const forced = insetCss(vp.w, vp.h, vp.safe ? 1 : 0);
  if (forced) await page.addInitScript((css) => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }), forced);
  const tag = `${vp.name}-${scheme}`;
  try {
    await page.goto(`${url}?gfx=low`);
    await page.waitForFunction(() => !!window.__coldgas?.stage, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    // The Show's run-up: held throttle, stepped in the page.
    await page.evaluate(() => { const g = window.__coldgas; g.setTier('assist'); g.startRun('jump'); g.skipCountdown(); });
    await page.waitForFunction(() => window.__coldgas.S.mode === 'live', null, { timeout: 20000 });
    // A finger is the device (a key would hide the touch controls); one-thumb holds its pad, classic rolls on.
    await page.evaluate(() => { const g = window.__coldgas; window.touchNow(); const t = g.touch.get().scheme === 'thumb'; if (t) g.thumb.down(); for (let i = 0; i < 90; i++) g.liveStep(1 / 60); if (t) g.thumb.up(); g.S.paused = true; });
    await settle(page);
    await frame(page, `${tag}-show-runup`, rows);
    // The reference in the air (after the release).
    await page.evaluate(() => { const g = window.__coldgas, G = g.S; G.paused = false; g.startRun('reveal'); g.skipCountdown(); for (let i = 0; i < 900 && !(G.run.phase === 'air' && G.run.car.pos.z < -9); i++) g.liveStep(1 / 30); G.paused = true;
      // The reference flies itself (no touch controls, its own cue): from here it is a player's run in the air.
      G.autopilot = null; const c = document.querySelector('[data-cue]'); if (c) { c.textContent = ''; c.classList.remove('on'); } document.querySelector('[data-touch]').hidden = false; window.touchNow(); });
    await settle(page);
    await frame(page, `${tag}-show-air`, rows);
    // Free Drive, rolling (its touch controls are the stick and the slots whatever the Show's scheme: flown once).
    if (scheme !== SCHEMES[SCHEMES.length - 1]) { await ctx.close(); continue; }
    await page.evaluate(() => window.__coldgas.toTitle());
    await page.goto(`${url}?gfx=low&drive=stelvio`);
    await page.waitForFunction(() => window.__coldgas?.drive?.active, null, { timeout: 90000 });
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__coldgas.drive.stats().speed > 6, null, { timeout: 60000 }).catch(() => {});
    await page.keyboard.up('ArrowUp');
    // The road's arrival title (a cue for its first seconds) is a moment, not the HUD: measured once it has gone.
    await page.waitForFunction(() => !document.querySelector('[data-cue]')?.classList.contains('on'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => { window.__coldgas.drive.pause?.(false); window.touchNow(); });
    await page.waitForTimeout(500);
    await frame(page, `${tag}-drive`, rows);
  } catch (e) { console.log(`${tag}: ${e.message.split('\n')[0]}`); rows.push({ name: tag, error: e.message.split('\n')[0] }); }
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/cover-report.json`, JSON.stringify(rows, null, 1));
if (flags.gate) {
  const ceil = (r) => { const [w, h] = r.name.match(/^(\d+)x(\d+)/).slice(1).map(Number); return coverCeiling(w, h); };
  const bad = rows.filter((r) => r.error || r.cover > ceil(r) || (r.car ?? 0) > 0.25);
  for (const r of bad) console.log(`FAIL ${r.name}: ${r.error || `cover ${(r.cover * 100).toFixed(1)}% (ceiling ${ceil(r) * 100}%), car ${((r.car ?? 0) * 100).toFixed(0)}%`}`);
  if (bad.length) process.exitCode = 1;
}
