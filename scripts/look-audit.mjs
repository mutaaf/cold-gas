// The look of the Show's climb and hang, in numbers (0187). Report-only.
//
//   node scripts/look-audit.mjs [url] [--out=dir] [--only=390x844,1440x900] [--gl=swiftshader|gpu]
//   LOOK_PRE='window.__coldgas.stage.bloom.strength = 0' node scripts/look-audit.mjs …   (attribution)
//
// Flies the reference Show on a synthetic 60 Hz clock (requestAnimationFrame is stubbed, as in
// scripts/flicker.mjs, so every run sees the same frames), stops at four moments, screenshots the page and
// measures two things on the screenshot (scripts/lib/look-measure.mjs):
//   red   the share of the frame that is saturated red (largest channel red, saturation > 0.5, value > 40)
//   P10   the 10th-percentile luma inside the roadster's projected box (its own oriented bounding box,
//         eight corners through the camera): low when the tyres, glass and shut lines read dark
// The bars (0187): red ≤ 12 % on a phone at the climb and the hang; P10 ≤ 60 there on every screen.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { redShare, lumaPercentile } from './lib/look-measure.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:4320/coldgas/';
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = opt('out', '');
const only = opt('only', '');
const gl = opt('gl', process.platform === 'darwin' ? 'gpu' : 'swiftshader');
if (out) mkdirSync(out, { recursive: true });

const SCREENS = [
  { name: '390x844', viewport: { width: 390, height: 844 }, touch: true },
  { name: '430x932', viewport: { width: 430, height: 932 }, touch: true },
  { name: '844x390', viewport: { width: 844, height: 390 }, touch: true },
  { name: '1440x900', viewport: { width: 1440, height: 900 }, touch: false },
].filter((s) => !only || only.split(',').includes(s.name));

// The moments (0187's table). Each is a predicate on the run, checked after every frame.
const MOMENTS = [
  ['climb', 'r.phase === "ramp" && r.car.pos.y >= 7'],
  ['hang-1.0', 'r.t.invertedTime >= 1.0'],
  ['hang-1.9', 'r.t.invertedTime >= 1.9'],
  ['release', 'r.phase === "air" && (G.__look.air ??= r.tick) && r.tick - G.__look.air >= 72'],   // 0.3 s after the release
];

// Variants (attribution, sweeps): LOOK_VARIANTS='{"base":"…js…","t13":"…js…"}' re-renders each frozen moment once
// per entry after running its page JS (set every knob absolutely: they run in order), so a sweep costs one flight.
const VARIANTS = process.env.LOOK_VARIANTS ? Object.entries(JSON.parse(process.env.LOOK_VARIANTS)) : [['', null]];

const GL = gl === 'gpu' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });
const rows = [];
for (const sc of SCREENS) {
  const page = await browser.newPage({ viewport: sc.viewport, deviceScaleFactor: 1, isMobile: sc.touch, hasTouch: sc.touch });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    const F = (window.__look = { manual: false, q: [], now: 0 });
    window.requestAnimationFrame = (cb) => { if (F.manual) { F.q.push(cb); return 1; } return native(cb); };
    try { localStorage.setItem('coldgas_howto', 'seen'); } catch { /* private window */ }
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__coldgas?.stage?.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.__coldgas.stage.ready);
  await page.evaluate(() => window.__coldgas.stage.backdrop);
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.__coldgas.physicsReady(), null, { timeout: 60000, polling: 100 });
  await page.evaluate(async () => {
    const F = window.__look;
    F.manual = true;
    await new Promise((r) => setTimeout(r, 200));
    F.now = performance.now() + 1000;
    F.frame = () => { F.now += 1000 / 60; for (const cb of F.q.splice(0)) cb(F.now); };
    const G = window.__coldgas;
    G.startRun('reveal'); G.skipCountdown();
  });
  // Attribution (as flicker.mjs's FLK_PRE): LOOK_PRE is page JS run once the run has started, to switch one
  // thing off (a bloom strength, a light, a mesh) and see what that alone does to the numbers.
  if (process.env.LOOK_PRE) await page.evaluate(process.env.LOOK_PRE);
  for (const [name, pred] of MOMENTS) {
    const hit = await page.evaluate((src) => {
      const F = window.__look, G = window.__coldgas;
      G.__look = G.__look || {};
      const test = new Function('r', 'G', `return ${src};`);
      for (let i = 0; i < 60 * 40; i++) {
        F.frame();
        const r = G.S.run;
        if (!r || G.S.mode !== 'live') return false;
        if (test(r, G)) return true;
      }
      return false;
    }, pred);
    if (!hit) { rows.push({ screen: sc.name, moment: name, missed: true }); continue; }
    // The roadster's box on screen: its own bounding box (every mesh under carRoot, in carRoot's frame).
    const box = await page.evaluate(() => {
      const G = window.__coldgas, root = G.carRoot, cam = G.camera;
      const V = cam.position.constructor, M = root.matrixWorld.constructor;
      root.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      const inv = new M().copy(root.matrixWorld).invert(), m = new M(), v = new V();
      const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        let shown = true; for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
        if (!shown) return;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox; m.multiplyMatrices(inv, o.matrixWorld);
        for (let k = 0; k < 8; k++) { v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(m); lo.min(v); hi.max(v); }
      });
      const W = innerWidth, H = innerHeight;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? hi.x : lo.x, k & 2 ? hi.y : lo.y, k & 4 ? hi.z : lo.z).applyMatrix4(root.matrixWorld).project(cam);
        const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, size: [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z].map((n) => +n.toFixed(2)) };
    });
    for (const [vname, vjs] of VARIANTS) {
      if (vjs !== null) await page.evaluate((js) => { const G = window.__coldgas; (0, eval)(js); G.stage.render(G.S.time, G.S.mode); }, vjs);
      const tag = vname ? `-${vname}` : '';
      const png = await page.screenshot(out ? { path: `${out}/${sc.name}-${name}${tag}.png` } : {});
      const m = await page.evaluate(async ({ b64, box, red, pct }) => {
        const redShare = new Function(`return (${red})`)(), lumaPercentile = new Function(`return (${pct})`)();
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const px = x.getImageData(0, 0, c.width, c.height).data;
        const s = c.width / innerWidth, r = { x: box.x * s, y: box.y * s, w: box.w * s, h: box.h * s };
        return { red: redShare(px, c.width, c.height), p10: lumaPercentile(px, c.width, c.height, r, 10), p50: lumaPercentile(px, c.width, c.height, r, 50) };
      }, { b64: png.toString('base64'), box, red: redShare.toString(), pct: lumaPercentile.toString() });
      const S = await page.evaluate(() => { const r = window.__coldgas.S.run; return { y: +r.car.pos.y.toFixed(1), inv: +r.t.invertedTime.toFixed(2), tick: r.tick }; });
      rows.push({ screen: sc.name, moment: name + tag, red: +(m.red * 100).toFixed(1), p10: m.p10, p50: m.p50, box: [Math.round(box.w), Math.round(box.h)], ...S });
      console.log(JSON.stringify(rows.at(-1)));
    }
    if (VARIANTS.length > 1) await page.evaluate((js) => (0, eval)(js), VARIANTS[0][1] ?? '0');   // back to the first before flying on
  }
  if (errors.length) console.log(sc.name, 'page errors:', errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();

console.log('\n| screen | moment | red % | car P10 / P50 | car box px |');
console.log('|---|---|---|---|---|');
for (const r of rows) console.log(r.missed ? `| ${r.screen} | ${r.moment} | missed | | |` : `| ${r.screen} | ${r.moment} | ${r.red} | ${r.p10} / ${r.p50} | ${r.box.join('×')} |`);
