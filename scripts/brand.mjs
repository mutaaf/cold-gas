// The install and share assets, rendered from their sources so they're reproducible (0081).
//
//   node scripts/brand.mjs                 icons from brand/icon.svg → public/ (no server needed)
//   node scripts/brand.mjs --shots <url>   + the share card (public/og.png) and the manifest's
//                                            screenshots, captured from the real game at <url>
//                                            (a `vite preview`, e.g. http://localhost:4733/coldgas/)
//   node scripts/brand.mjs --check         measure the maskable icon's safe zone and each PNG's size
//
// The mark lives in brand/icon.svg: a <g id="plate"> (the rounded plate) and a <g id="mark">. Every
// icon is that file, re-framed: "any" icons keep the rounded plate (transparent corners), the
// maskable and Apple icons put the mark on a full-bleed square (the OS cuts its own shape), the
// maskable one scaled into the central 80 % circle. public/favicon.svg is the source itself.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SRC = readFileSync('brand/icon.svg', 'utf8');
const defs = SRC.match(/<defs>[\s\S]*?<\/defs>/)[0];
const mark = SRC.match(/<g id="mark">[\s\S]*?<\/g>/)[0];
const plate = SRC.match(/<g id="plate">[\s\S]*?<\/g>/)[0];
const BG = '#05070c';
const OG_X = -150;   // the link preview's crop into its 2000 px frame (see shots())
// A full-bleed square plate: the same light, no corners, no rim (the OS draws the edge).
const square = '<rect width="1024" height="1024" fill="url(#cg-plate)" /><rect width="1024" height="1024" fill="url(#cg-bloom)" />';
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}${body}</svg>`;
// The maskable safe zone is a circle of radius 0.4 × size. The G's farthest point (a corner of its
// rounded rectangle) is 368 of 1024 from the centre (0.359), so the mark fits it at full size and
// every variant uses one geometry. `--check` measures it on the rendered PNG.
const VARIANTS = {
  any: svg(plate + mark),
  maskable: svg(square + mark),
  apple: svg(square + mark),
};
const ICONS = [
  ['public/icons/icon-512.png', 'any', 512],
  ['public/icons/icon-192.png', 'any', 192],
  ['public/icons/maskable-512.png', 'maskable', 512],
  ['public/icons/maskable-192.png', 'maskable', 192],
  ['public/apple-touch-icon.png', 'apple', 180],
  ['public/favicon-32.png', 'any', 32],
  ['public/favicon-16.png', 'any', 16],
];

const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const browser = await chromium.launch({ args: shotsAt ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });

async function renderSvg(markup, size, path, opaque) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const src = `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
  await page.setContent(`<html><body style="margin:0;background:${opaque ? BG : 'transparent'}"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path, omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}

// Measures a PNG in the browser: its size, whether it has any transparent pixel, and the farthest
// bright pixel (the chrome and the jet's core) from the centre as a fraction of the size.
async function measure(path) {
  const page = await browser.newPage();
  const data = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  const r = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let alpha = false, far = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 255) alpha = true;
      if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] > 300) {
        const p = i / 4, x = p % c.width + 0.5, y = Math.floor(p / c.width) + 0.5;
        far = Math.max(far, Math.hypot(x - c.width / 2, y - c.height / 2));
      }
    }
    return { w: img.width, h: img.height, alpha, reach: far / c.width };
  }, data);
  await page.close();
  return r;
}

if (args.includes('--check')) {
  for (const [path] of ICONS) console.log(path, JSON.stringify(await measure(path)));
  const m = await measure('public/icons/maskable-512.png');
  console.log(m.reach <= 0.4 ? 'maskable safe zone OK' : 'maskable mark OUTSIDE the safe zone', m.reach.toFixed(3));
  await browser.close();
  process.exit(m.reach <= 0.4 ? 0 : 1);
}

mkdirSync('public/icons', { recursive: true });
for (const [path, v, size] of ICONS) await renderSvg(VARIANTS[v], size, path, v !== 'any');
writeFileSync('public/favicon.svg', SRC.replace(/\s*<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim() + '\n');
console.log('icons:', ICONS.map(([p]) => p).join(' '));

if (shotsAt) await shots(shotsAt);
await browser.close();

// --- From the real game ---------------------------------------------------------------------
async function shots(url) {
  mkdirSync('public/screenshots', { recursive: true });
  const font = (f) => `data:font/woff2;base64,${readFileSync(`node_modules/${f}`).toString('base64')}`;
  const faces = `
    @font-face { font-family: Michroma; src: url(${font('@fontsource/michroma/files/michroma-latin-400-normal.woff2')}); }
    @font-face { font-family: Geist; font-weight: 100 900; src: url(${font('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')}); }
    @font-face { font-family: 'Geist Mono'; src: url(${font('@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2')}); }`;

  // The moment: the replay's camera as the car leaves the Wall's lip upside down, lamps lit, the LED
  // edges climbing to it (the reference run at replay frame 598, just before the cut to the wide
  // shot). The run is deterministic, so it's the same frame on every capture.
  const LIP = 598;
  async function capture(view, { moment = false, settle = 3500, type = 'jpeg' } = {}) {
    const page = await browser.newPage(view);
    await page.goto(url);
    await page.waitForFunction(() => window.__coldgas?.S?.mode === 'title', null, { timeout: 30000 });
    await page.waitForTimeout(settle);
    if (moment) {
      await page.evaluate(() => { window.__coldgas.startRun('reveal'); window.__coldgas.fastForward(); });
      await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 30000 });
      await page.addStyleTag({ content: 'body *:not(#stage) { visibility: hidden !important; }' });
      await page.waitForFunction((t) => window.__coldgas.S.replayT >= t, LIP, { timeout: 90000, polling: 'raf' });
    }
    const buf = await page.screenshot(type === 'jpeg' ? { type, quality: 90 } : { type });
    await page.close();
    return buf;
  }

  const phone = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const wide = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
  writeFileSync('public/screenshots/narrow-title.jpg', await capture(phone));
  writeFileSync('public/screenshots/narrow-air.jpg', await capture(phone, { moment: true }));
  writeFileSync('public/screenshots/wide-title.jpg', await capture(wide));
  writeFileSync('public/screenshots/wide-air.jpg', await capture(wide, { moment: true }));

  // The link preview (1200 × 630, what every preview crops to): the same frame shot wider than the
  // card (2000 × 630 at 2×: the camera keeps its vertical field, so the extra width is open night sky)
  // and cropped 150 px in, which puts the car on the right quarter and leaves the left for the type.
  const frame = await capture({ viewport: { width: 2000, height: 630 }, deviceScaleFactor: 2 }, { moment: true, type: 'png' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${faces}
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: ${BG}; }
    .f { position: absolute; inset: 0; background: url(data:image/png;base64,${frame.toString('base64')}) ${OG_X}px 0 / 2000px 630px no-repeat; }
    .s { position: absolute; inset: 0; background:
      linear-gradient(90deg, rgba(5,7,12,.86) 0%, rgba(5,7,12,.55) 28%, rgba(5,7,12,0) 50%),
      linear-gradient(0deg, rgba(5,7,12,1) 0%, rgba(5,7,12,.8) 7%, rgba(5,7,12,0) 24%),
      radial-gradient(130% 100% at 72% 40%, transparent 50%, rgba(2,3,6,.5) 100%); }
    .t { position: absolute; left: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
    .e { font: 400 13px/1 'Geist Mono'; letter-spacing: .34em; text-transform: uppercase; color: rgba(191,230,255,.86); margin: 0 0 28px 2px; }
    h1 { font: 400 88px/1 Michroma; letter-spacing: .05em; margin: 0;
      background: linear-gradient(180deg, #ffffff 0%, #e9eef3 44%, #a7b0bc 49.5%, #dde3ea 55%, #f7f9fb 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    .l { width: 48px; height: 1px; background: rgba(245,246,248,.45); margin: 34px 0 22px 2px; }
    p { font: 400 21px/1.35 Geist; letter-spacing: .01em; color: rgba(245,246,248,.84); margin: 0 0 0 2px; }
    .u { position: absolute; left: 82px; bottom: 48px; font: 400 13px/1 'Geist Mono'; letter-spacing: .2em; color: rgba(245,246,248,.56); }
    </style></head><body><div class="f"></div><div class="s"></div>
    <div class="t"><div class="e">Ten cold-gas thrusters</div><h1>COLD<br>GAS</h1><div class="l"></div><p>One roll. Stick the landing.</p></div>
    <div class="u">MUTAAFAZIZ.COM/COLDGAS</div>
    </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'public/og.png' });
  await page.close();
  console.log('shots: public/og.png public/screenshots/{narrow,wide}-{title,air}.jpg');
}
