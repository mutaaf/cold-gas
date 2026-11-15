// The touchdown cloud's lower edge (0217), as a gate: flies the reference run (`startRun('reveal')`) on each course and
// size, freezes the first landed frame (`S.run.phase === 'landed'`), renders it with the mist on and with
// `plumes.points.visible = false`, and diffs the two (luma). The mist's mask is the diff ≥ 8. In each column its lowest
// row is the cloud's lower edge; that column is *sharp* when the diff falls from ≥ 20 to < 5 within 2 px there. The
// longest horizontal run of sharp columns (each within 1 px of its neighbour's row) is the straight base the ground's
// depth test cuts into the sprites. Bar: ≤ 40 CSS px on every frame (exit 1 otherwise). Also printed, report only: the
// edge's width (median over the mist's columns, CSS px), from the last row at half the cloud's diff above it to the
// first row under 5: a fade into the ground is wide, a cut is a few pixels.
// The resolution governor is pinned at 1 for the two renders: a software rasterizer steps it down, and the upscale
// blurs the very edge this measures.
// node scripts/mist-edge.mjs <url> [outdir] [--sizes=390x844t,1440x900] [--courses=show,wall,lineup] [--gfx=low|mid|high]
//   [--dpr=2]   a size ending in t is a touch phone, drawn at deviceScaleFactor --dpr (default 2, as a phone is; the
//   desktop sizes at 1). Needs a served build (`npx vite preview --port 4655 --strictPort`).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const pos = args.filter((s) => !s.startsWith('--'));
const url = pos[0] || 'http://localhost:4655/coldgas/';
const out = pos[1] || null;
const sizes = flag('sizes', '390x844t,1440x900').split(',');
const courses = flag('courses', 'show,wall,lineup').split(',');
const gfx = flag('gfx', '');
const phoneDpr = Number(flag('dpr', '2'));
const BAR = 40;
if (out) mkdirSync(out, { recursive: true });

const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

// The longest straight, sharp run along the mask's lower boundary (device px), the boundary's row there, and the edge's
// median width (device px).
export function straightBase(a, b, w, h) {
  const diff = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) diff[i] = Math.abs(luma(a, i * 4) - luma(b, i * 4));
  let best = 0, run = 0, prev = -9, bestY = -1, px = 0;
  const widths = [];
  for (let x = 0; x < w; x++) {
    let yb = -1;
    for (let y = h - 1; y >= 0; y--) if (diff[y * w + x] >= 8) { yb = y; break; }
    let sharp = false;
    if (yb > 0 && yb < h - 2) {
      const top = Math.max(diff[yb * w + x], diff[(yb - 1) * w + x]);
      sharp = top >= 20 && diff[(yb + 1) * w + x] < 5;
    }
    if (yb >= 0) px++;
    if (yb >= 24 && yb < h - 2) {
      const above = [];
      for (let y = yb - 24; y < yb - 6; y++) above.push(diff[y * w + x]);
      above.sort((p, q) => p - q);
      const half = above[above.length >> 1] * 0.5;
      let yh = yb; while (yh > yb - 24 && diff[yh * w + x] < half) yh--;
      let y5 = yb; while (y5 < h - 1 && diff[y5 * w + x] >= 5) y5++;
      widths.push(y5 - yh);
    }
    if (sharp && run > 0 && Math.abs(yb - prev) <= 1) run++;
    else run = sharp ? 1 : 0;
    prev = sharp ? yb : -9;
    if (run > best) { best = run; bestY = yb; }
  }
  widths.sort((p, q) => p - q);
  return { run: best, y: bestY, columns: px, width: widths.length ? widths[widths.length >> 1] : null };
}

// A PNG's pixels, decoded by the page (no image library in the repo).
async function rgba(page, png) {
  const m = await page.evaluate(async (b64) => {
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
    const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
    return { w: cv.width, h: cv.height, px: btoa(s) };
  }, png.toString('base64'));
  return { width: m.w, height: m.h, data: Buffer.from(m.px, 'base64') };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const rows = [];
  for (const course of courses) for (const size of sizes) {
    const touch = size.endsWith('t');
    const [w, h] = size.replace(/t$/, '').split('x').map(Number);
    const ctx = await browser.newContext(touch
      ? { viewport: { width: w, height: h }, deviceScaleFactor: phoneDpr, isMobile: true, hasTouch: true }
      : { viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('coldgas_howto', 'seen'); } catch {} });
    const page = await ctx.newPage();
    const q = [course !== 'show' ? `course=${course}` : '', gfx ? `gfx=${gfx}` : ''].filter(Boolean).join('&');
    await page.goto(url + (q ? `?${q}` : ''));
    await page.waitForFunction(() => window.__coldgas?.physicsReady && window.__coldgas.S.mode === 'title', null, { timeout: 120000 });
    await page.evaluate(async () => { await window.__coldgas.physicsReady; });
    await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.skipCountdown(); });
    const hit = await page.waitForFunction(() => { const S = window.__coldgas.S; if (S.run && S.mode === 'live' && S.run.phase === 'landed') { S.paused = true; return true; } return false; },
      null, { timeout: 600000, polling: 'raf' }).then(() => true).catch(() => false);
    if (!hit) { rows.push({ course, size, run: null }); await ctx.close(); continue; }
    await page.waitForTimeout(300);
    const dpr = touch ? phoneDpr : 1;
    // Full resolution, applied by the next render (scene.js setPixelScale: a refit never lands between a draw and its
    // presentation).
    await page.evaluate(() => { const g = window.__coldgas; g.stage.setPixelScale(1); g.stage.render(g.S.time, g.S.mode); });
    const shoot = async (on) => {
      await page.evaluate((v) => { const g = window.__coldgas; const was = g.plumes.points.visible; g.plumes.points.visible = v && was; g.stage.render(g.S.time, g.S.mode); g.plumes.points.visible = was; }, on);
      return page.screenshot();
    };
    // The canvas keeps its last frame (preserveDrawingBuffer or not, the screenshot composites what was presented), so
    // render, shoot, and render again for the other.
    const withMist = await shoot(true), without = await shoot(false);
    const A = await rgba(page, withMist), B = await rgba(page, without);
    const raw = straightBase(A.data, B.data, A.width, A.height);
    const css = (v) => (v == null ? null : Math.round(v / dpr));
    const r = { run: css(raw.run), y: css(raw.y), columns: css(raw.columns), width: raw.width == null ? null : Math.round(raw.width / dpr * 10) / 10, dpr };
    if (out) { writeFileSync(`${out}/${course}-${size}-mist.png`, withMist); writeFileSync(`${out}/${course}-${size}-nomist.png`, without); }
    rows.push({ course, size, ...r });
    console.error(`  ${course} ${size}: straight base ${r.run} px at y ${r.y}, edge width ${r.width} px (${r.columns} columns of mist)`);
    await ctx.close();
  }
  await browser.close();
  console.log('course size        straight base px   at y   edge width px   mist columns   (CSS px)');
  for (const r of rows) console.log(`${r.course.padEnd(6)} ${r.size.padEnd(11)} ${String(r.run ?? 'miss').padStart(16)}   ${String(r.y ?? '').padStart(4)}   ${String(r.width ?? '').padStart(13)}   ${r.columns ?? ''}`);
  if (out) writeFileSync(`${out}/mist-edge.json`, JSON.stringify(rows, null, 1));
  const bad = rows.filter((r) => r.run == null || r.run > BAR);
  if (bad.length) { console.log(`FAIL: ${bad.length} frame(s) over the ${BAR} px bar (or missed)`); process.exit(1); }
  console.log(`ok: every straight base ≤ ${BAR} px`);
}
