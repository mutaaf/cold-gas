// Dev: the judges' theatre, legible? Screenshots of every stage plus measured WCAG contrast for
// every piece of text in and around it, on a 1280×720 desktop and a 390×844 phone, for both a
// failed call (local lines) and a mocked streaming model answer.
//
//   npm run build && npx vite preview --port 4312 --strictPort &
//   node scripts/theatre-shots.mjs [outdir] [url]
//
// Contrast is measured from pixels, not from CSS: for each moment we take the frame (A), then the
// same frame with every text glyph made transparent (B, scrims and shadows kept). Per element:
// text = the bright glyph cores (90th percentile of the pixels A adds over B); background = the
// 90th-percentile (lighter, i.e. worst-case) pixel of B inside the text's box. Ratio is WCAG 2.x.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || 'shots/theatre';
const url = process.argv[3] || 'http://localhost:4312/coldgas/';
mkdirSync(out, { recursive: true });

const TEXT = [
  ['rail: stage (active)', '.th-rail li.on .l'],
  ['rail: stage (done)', '.th-rail li.done .l'],
  ['rail: stage (next)', '.th-rail li:not(.on):not(.done) .l'],
  ['rail: number', '.th-rail li .n'],
  ['caption', '.th-caption'],
  ['card: eyebrow', '.th-eyebrow'],
  ['card: model', '.th-model b'],
  ['card: vendor', '.th-model span'],
  ['card: label', '.th-meta dt'],
  ['card: value', '.th-meta dd'],
  ['counter: label', '.th-stats dt'],
  ['counter: value', '.th-stats dd'],
  ['stream: reasoning', '.th-reason'],
  ['stream: words', '.th-out'],
  ['skip', '.th-skip'],
  ['results: headline', '[data-r-headline]'],
  ['results: / 100', '.total span'],
  ['receipt: head', '.rc-head b'],
  ['receipt: model', '.rc-head code'],
  ['receipt: where', '.rc-where'],
  ['receipt: stats', '.rc-stats span'],
  ['receipt: actions', '.rc-actions .btn'],
  ['receipt: inspect', '.rc-inspect summary'],
  ['judge: role', '.judges .role'],
  ['judge: quote', '.judges .quote'],
  ['category label', '.cat .lbl span'],
];
const HIDE = `.theatre *, .results * { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; }
.th-skip, .rc-actions .btn { border-color: transparent; }`;

// A believable streamed answer: reasoning first, then the words, token by token.
function sse() {
  const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
  const words = {
    headline: 'Clean over the row',
    engineer: 'Sink rate 0.6 m/s and four wheels inside 18 ms. The retro burn did its job; I would sign that landing off.',
    coordinator: 'You carried the speed off the ledge and never asked the thrusters for more than they had. That is the stunt.',
    designer: 'One unbroken line from lip to pad. The roll sat on the apex like it was drawn there.',
    source: 'ai',
  };
  const reasoning = 'Checking the card: clearance positive, roll complete, touchdown under 1 m/s, pad miss small. Tone: dry, specific, one number each. '.split(/(?<= )/);
  const text = `ENGINEER: ${words.engineer}\nCOORDINATOR: ${words.coordinator}\nDESIGNER: ${words.designer}\nHEADLINE: ${words.headline}`.split(/(?<= )/);
  let s = ev('verify', { ticks: 2412, ms: 38, card: { total: 88.4 } });
  s += ev('prompt', { provider: 'edge', providerLabel: 'Free', vendor: 'Workers AI', model: '@cf/google/gemma-4-26b-a4b-it', where: 'Cloudflare edge', system: 'You are three judges…', user: 'Facts: …', inTokensEst: 612 });
  for (const t of reasoning) s += ev('reasoning', { t });
  for (const t of text) s += ev('token', { t });
  s += ev('done', { words, inTokens: 618, outTokens: reasoning.length + text.length, ttftMs: 412, totalMs: 2380, tokensPerSec: 41, neurons: 13, costUsd: null, raw: text.join('') });
  return s;
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const decoder = await browser.newPage();
const report = [];

async function measure(png, pngHidden, rects) {
  return decoder.evaluate(async ({ a, b, rects, dpr }) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const A = px(ia), B = px(ib), W = ia.width, H = ia.height;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    const pct = (arr, p) => { if (!arr.length) return null; arr.sort((x, y) => x - y); return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; };
    return rects.map(({ x, y, w, h }) => {
      const x0 = Math.max(0, Math.floor(x * dpr)), y0 = Math.max(0, Math.floor(y * dpr)), x1 = Math.min(W, Math.ceil((x + w) * dpr)), y1 = Math.min(H, Math.ceil((y + h) * dpr));
      const glyph = [], bg = [];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4, la = L(A, i), lb = L(B, i);
        bg.push(lb);
        if (la - lb > 0.02) glyph.push(la);
      }
      const t = pct(glyph, 0.9), b90 = pct(bg, 0.9), b50 = pct(bg.slice(), 0.5);
      if (t == null || b90 == null) return null;
      const cr = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      return { ratio: +cr(t, b90).toFixed(2), ratioMedianBg: +cr(t, b50).toFixed(2) };
    });
  }, { a: png.toString('base64'), b: pngHidden.toString('base64'), rects, dpr: await currentDpr });
}
let currentDpr = 1;

async function moment(page, label, file) {
  const items = await page.evaluate((TEXT) => {
    const res = [];
    for (const [name, sel] of TEXT) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.textContent.trim()) continue;
        const cs = getComputedStyle(el);
        let vis = true;
        for (let n = el; n; n = n.parentElement) { if (n.hidden || getComputedStyle(n).display === 'none') vis = false; }
        // Skip text that is still fading in (a mid-animation frame is not what anyone reads).
        for (let n = el; n; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) < 0.99) vis = false; }
        if (!vis || cs.visibility === 'hidden') continue;
        const r = document.createRange(); r.selectNodeContents(el);
        const rect = [...r.getClientRects()].filter((q) => q.width > 2 && q.height > 2 && q.bottom > 0 && q.top < innerHeight && q.right > 0 && q.left < innerWidth).pop();
        if (!rect) continue;
        // Skip text covered by something else (the phone theatre covers the results sheet).
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
        res.push({ name, rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) });
        break;   // one representative per selector
      }
    }
    return res;
  }, TEXT);
  const a = await page.screenshot({ path: `${out}/${file}.png` });
  await page.addStyleTag({ content: HIDE }).then((h) => h.evaluate((n) => n.setAttribute('data-hide', '')));
  const b = await page.screenshot();
  await page.evaluate(() => document.querySelectorAll('style[data-hide]').forEach((n) => n.remove()));
  const res = await measure(a, b, items.map((i) => i.rect));
  const rows = items.map((it, k) => ({ moment: label, text: it.name, px: it.size, weight: it.weight, ...(res[k] || {}) })).filter((r) => r.ratio);
  for (const r of rows) {
    const large = r.px >= 24 || (r.px >= 18.66 && r.weight >= 700);
    r.need = large ? 3 : 4.5;
    r.pass = r.ratio >= r.need;
  }
  report.push(...rows);
  console.log(`\n${label}  → ${out}/${file}.png`);
  for (const r of rows) console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(6)}:1 (median bg ${String(r.ratioMedianBg).padStart(5)})  ${r.px}px/${r.weight}  ${r.text}`);
}

async function scenario({ name, viewport, mobile, stream }) {
  currentDpr = mobile ? 3 : 1;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: currentDpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  if (stream) await page.route('**/coldgas/api/judge/stream', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse() }));
  else await page.route('**/coldgas/api/**', (route) => route.fulfill({ status: 404, body: 'no api' }));
  await page.goto(url + '?play=reveal&gfx=low');
  await page.waitForFunction(() => window.__coldgas?.S.mode === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => window.__coldgas.fastForward());
  const stage = (i) => page.waitForFunction((i) => document.querySelectorAll('.th-rail li')[i]?.classList.contains('on'), i, { timeout: 40_000, polling: 16 });
  await stage(0); await page.waitForTimeout(700);
  await moment(page, `${name} · 01 telemetry`, `${name}-1-telemetry`);
  await stage(1); await page.waitForTimeout(1500);
  await moment(page, `${name} · 02 text`, `${name}-2-text`);
  await stage(2); await page.waitForTimeout(stream ? 1100 : 300);
  await moment(page, `${name} · 03 compute${stream ? ' (streaming)' : ' (local lines)'}`, `${name}-3-compute`);
  await stage(3); await page.waitForTimeout(1200);
  await moment(page, `${name} · 04 verdict`, `${name}-4-verdict`);
  await page.waitForFunction(() => document.querySelector('[data-theatre]').hidden && !document.querySelector('[data-receipt]').hidden, null, { timeout: 20_000 });
  await page.waitForTimeout(3500);
  await moment(page, `${name} · 05 results`, `${name}-5-results`);
  await ctx.close();
}

await scenario({ name: 'desktop-local', viewport: { width: 1280, height: 720 }, mobile: false, stream: false });
await scenario({ name: 'desktop-stream', viewport: { width: 1280, height: 720 }, mobile: false, stream: true });
await scenario({ name: 'phone-local', viewport: { width: 390, height: 844 }, mobile: true, stream: false });
await scenario({ name: 'phone-stream', viewport: { width: 390, height: 844 }, mobile: true, stream: true });
writeFileSync(`${out}/contrast.json`, JSON.stringify(report, null, 1));
const fails = report.filter((r) => !r.pass);
console.log(`\n${report.length} measurements, ${fails.length} below AA. Worst: ${report.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 5).map((r) => `${r.ratio}:1 ${r.text} (${r.moment})`).join('; ')}`);
await browser.close();
