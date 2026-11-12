// How the Wall's run-up, climb and hang read (0187, 0193), report-only: flies the reference run (`startRun('reveal')`)
// on each course at a phone and a desktop size, freezes it in the countdown (1.5 s in), on the run-up (tick 264), at
// the climb (car 6–8 m up), on the curl at invertedTime 1.0 s and 1.9 s after the release and at touchdown, then presses Replay and
// freezes the replay 1.5 s, 2 s and 4 s in; screenshots each moment and prints:
//   red  the frame's saturated-red share (scripts/look-measure.mjs; bar ≤ 12 % on every moment but the release)
//   p10  the 10th-percentile luma in the roadster's projected 4.4 × 2.0 × 1.2 m box (bar ≤ 60: its tyres and
//        glass show dark)
// node scripts/look-audit.mjs <url> [outdir] [--sizes=390x844t,1440x900,...] [--courses=show,wall] [--only=count,runup,...]
//   [--gfx=low|mid|high]
//   a size ending in t is a touch phone (isMobile, hasTouch), drawn at deviceScaleFactor 1 (CSS pixels). Needs a served build
//   (`npx vite preview --port 4655 --strictPort`).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { redShare, lumPercentile } from './look-measure.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const pos = args.filter((s) => !s.startsWith('--'));
const url = pos[0] || 'http://localhost:4655/coldgas/';
const out = pos[1] || null;
const sizes = flag('sizes', '390x844t,1440x900,430x932t,844x390t').split(',');
const gfx = flag('gfx', '');
const pre = flag('pre', '');   // experiments: JS run in the page before the run (window.__coldgas as g)
const only = flag('only', '');
const courses = flag('courses', 'show').split(',');
if (out) mkdirSync(out, { recursive: true });

// The moments, as predicates on the live run (the car's centre is its CoM, 0.40 m above its floor).
const MOMENTS = [
  ['count', 'S.mode === "countdown" && S.countT >= 1.5'],
  ['runup', 'S.mode === "live" && S.run.tick >= 264'],
  ['climb', 'S.run.phase === "ramp" && S.run.car.pos.y > 6.4 && S.run.t.invertedTime === 0'],
  ['hang1', 'S.run.phase === "ramp" && S.run.t.invertedTime >= 1.0'],
  ['hang2', 'S.run.phase === "ramp" && S.run.t.invertedTime >= 1.9'],
  ['release', 'S.run.phase === "air" && S.run.car.pos.y < 18'],
  ['land', 'S.mode === "live" && S.run.phase === "landed"'],   // touchdown (report only: the Wall's pad is by the foot)
  // The replay, pressed from the results (on a phone it plays full-frame above the peek), t seconds in.
  ['replay1', '(S.mode === "results" || S.mode === "replay") && S.peekPressed && S.replayT * 4 / 240 >= 1.5'],
  ['replay2', '(S.mode === "results" || S.mode === "replay") && S.peekPressed && S.replayT * 4 / 240 >= 2'],
  ['replay4', '(S.mode === "results" || S.mode === "replay") && S.peekPressed && S.replayT * 4 / 240 >= 4'],
];

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
const rows = [];
for (const course of courses) for (const size of sizes) {
  const touch = size.endsWith('t');
  const [w, h] = size.replace(/t$/, '').split('x').map(Number);
  const ctx = await browser.newContext(touch
    ? { viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('coldgas_howto', 'seen'); } catch {} });
  const page = await ctx.newPage();
  const q = [course !== 'show' ? `course=${course}` : '', gfx ? `gfx=${gfx}` : ''].filter(Boolean).join('&');
  await page.goto(url + (q ? `?${q}` : ''));
  await page.waitForFunction(() => window.__coldgas?.physicsReady && window.__coldgas.S.mode === 'title', null, { timeout: 120000 });
  await page.evaluate(async () => { await window.__coldgas.physicsReady; });
  if (pre) await page.evaluate(`(() => { const g = window.__coldgas; ${pre} })()`);
  await page.evaluate(() => { window.__coldgas.startRun('reveal'); });
  const want = MOMENTS.filter(([n]) => (!only || only.split(',').includes(n)));
  if (!want.some(([n]) => n === 'count')) await page.evaluate(() => window.__coldgas.skipCountdown());
  if (want.some(([n]) => n.startsWith('replay'))) {
    // Press Replay once the sheet is up (a real tap's path: peek on a phone, replayFrom(0)).
    page.waitForFunction(() => window.__coldgas.S.mode === 'results' && !document.querySelector('[data-screen="results"]').hidden, null, { timeout: 600000 })
      .then(() => page.evaluate(() => { document.querySelector('[data-replay]').click(); window.__coldgas.S.peekPressed = true; })).catch(() => {});
  }
  for (const [name, pred] of want) {
    // Freeze in the predicate itself, so the frame on the glass is the one that met it.
    const fn = `(() => { const S = window.__coldgas.S; if (S.run && (${pred})) { S.paused = true; return true; } return false; })()`;
    const hit = await page.waitForFunction(fn, null, { timeout: 600000, polling: 'raf' }).then(() => true).catch(() => false);
    if (!hit) { rows.push({ course, size, moment: name, red: null, p10: null }); continue; }
    await page.waitForTimeout(300);
    await page.evaluate(() => { const g = window.__coldgas; g.stage.render(g.S.time, g.S.mode); });
    const shot = await page.screenshot();
    if (out) writeFileSync(`${out}/${course}-${size}-${name}.png`, shot);
    const m = await page.evaluate(async (b64) => {
      const g = window.__coldgas, cam = g.camera, root = g.carRoot;
      root.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      const e = root.matrixWorld.elements, P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements;
      const mul = (M, x, y, z, ww) => [M[0] * x + M[4] * y + M[8] * z + M[12] * ww, M[1] * x + M[5] * y + M[9] * z + M[13] * ww, M[2] * x + M[6] * y + M[10] * z + M[14] * ww, M[3] * x + M[7] * y + M[11] * z + M[15] * ww];
      const cy = g.hero.comY;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const bx of [-1, 1]) for (const by of [-cy, 1.2 - cy]) for (const bz of [-2.2, 2.2]) {
        const wp = mul(e, bx, by, bz, 1), vp = mul(V, ...wp), cp = mul(P, ...vp);
        if (cp[3] <= 0.05) return null;   // a corner behind the camera: no honest box
        const sx = (cp[0] / cp[3] * 0.5 + 0.5) * innerWidth, sy = (0.5 - cp[1] / cp[3] * 0.5) * innerHeight;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
      const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return { w: cv.width, h: cv.height, px: btoa(s), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, y: root.position.y, inv: g.S.run.t.invertedTime, tier: g.stage.tier ?? null };
    }, shot.toString('base64'));
    if (!m) { rows.push({ course, size, moment: name, red: null, p10: null }); await page.evaluate(() => { window.__coldgas.S.paused = false; }); continue; }
    const rgba = Buffer.from(m.px, 'base64');
    rows.push({
      course, size, moment: name,
      red: Math.round(redShare(rgba, m.w, m.h) * 1000) / 10,
      p10: lumPercentile(rgba, m.w, m.h, m.box, 10), p50: lumPercentile(rgba, m.w, m.h, m.box, 50),
      boxPx: `${Math.round(m.box.w)}×${Math.round(m.box.h)}`, carY: Math.round(m.y * 10) / 10, inv: Math.round(m.inv * 100) / 100,
    });
    const r = rows[rows.length - 1];
    console.error(`  ${course} ${size} ${name}: red ${r.red} %, P10 ${r.p10}`);   // progress (stderr), the table follows
    await page.evaluate(() => { window.__coldgas.S.paused = false; });
  }
  await ctx.close();
}
await browser.close();
console.log('course size        moment   red %   box P10 / P50   box px    car y   inverted s');
for (const r of rows) {
  console.log(`${r.course.padEnd(6)} ${r.size.padEnd(11)} ${r.moment.padEnd(8)} ${String(r.red ?? 'miss').padStart(5)}   ${String(r.p10 ?? '-').padStart(4)} / ${String(r.p50 ?? '-').padEnd(5)}   ${(r.boxPx || '').padEnd(9)} ${String(r.carY ?? '').padStart(5)}   ${r.inv ?? ''}`);
}
if (out) writeFileSync(`${out}/look.json`, JSON.stringify(rows, null, 1));
