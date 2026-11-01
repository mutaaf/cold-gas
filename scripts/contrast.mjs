// WCAG contrast of on-screen text, measured on real screenshots (shared by scripts/hud-audit.mjs and
// scripts/title-audit.mjs, 0069). Two shots of the same still frame: `shot` with the text, `bare` with it
// hidden. Each text's own colour (and effective opacity) is composited over every other pixel of the bare
// shot inside its box (inset 2 px: a box's own border is not the background behind its glyphs), and the
// ratio it reports is the worst 10 % of those pixels (W3C F83: the lightest region behind light text).
//   texts: [{ t, px, color, op, clipped?, r: { x, y, w, h } }] in CSS px → [{ t, px, ratio }] (ratio null:
//   clipped or no pixels).
export async function textContrast(page, shot, bare, texts) {
  return page.evaluate(async ({ bareB64, texts, dpr }) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
    const bimg = await load(bareB64);
    const cv = new OffscreenCanvas(bimg.width, bimg.height), cx = cv.getContext('2d');
    cx.drawImage(bimg, 0, 0);
    const bg = cx.getImageData(0, 0, cv.width, cv.height).data;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) || [255, 255, 255, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    return texts.map((t) => {
      if (t.clipped) return { t: t.t, px: t.px, ratio: null };
      const c = parse(t.color), a = c.a * t.op;
      const ins = Math.min(2, t.r.w / 4, t.r.h / 4);
      const x0 = Math.max(0, Math.floor((t.r.x + ins) * dpr)), y0 = Math.max(0, Math.floor((t.r.y + ins) * dpr));
      const x1 = Math.min(cv.width, Math.ceil((t.r.x + t.r.w - ins) * dpr)), y1 = Math.min(cv.height, Math.ceil((t.r.y + t.r.h - ins) * dpr));
      const ls = [];
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * cv.width + x) * 4;
        // the text's own colour composited over this background pixel
        const tr = c.r * a + bg[i] * (1 - a), tg = c.g * a + bg[i + 1] * (1 - a), tb = c.b * a + bg[i + 2] * (1 - a);
        const lt = L(tr, tg, tb), lb = L(bg[i], bg[i + 1], bg[i + 2]);
        ls.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05));
      }
      if (!ls.length) return { t: t.t, px: t.px, ratio: null };
      ls.sort((p, q) => p - q);
      return { t: t.t, px: t.px, ratio: Math.round(ls[Math.floor(ls.length * 0.1)] * 100) / 100 };   // the worst 10 %
    });
  }, { bareB64: bare.toString('base64'), texts, dpr: await page.evaluate(() => devicePixelRatio) });
}
