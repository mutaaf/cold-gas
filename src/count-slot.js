// The countdown numeral's slot (0070): the free band of the screen it stands in, measured once as a
// countdown starts and held for its ticks (3 · 2 · 1, or READY), so it never moves between them.
// Pure: the viewport height, the numeral's box and the boxes already on the glass in, a band out.
//
// A box counts when it crosses the numeral's column (it is centred on the screen). The bands between
// them (each box padded by `pad`) are the candidates: the one nearest the middle of the screen that
// holds the numeral wins; if none does, the tallest, and the numeral is scaled to fit it.
export function countSlot(vh, boxes, numW, numH, vw, pad = 8) {
  const x0 = (vw - numW) / 2, x1 = (vw + numW) / 2;
  const spans = [];
  for (const b of boxes) {
    if (!(b.r > x0 && b.x < x1 && b.b > b.y)) continue;
    spans.push([Math.max(0, b.y - pad), Math.min(vh, b.b + pad)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let at = 0;
  for (const [a, b] of spans) { if (a > at) gaps.push([at, a]); at = Math.max(at, b); }
  if (at < vh) gaps.push([at, vh]);
  if (!gaps.length) return { top: 0, bottom: 0, scale: 1 };
  const mid = vh / 2, off = (g) => Math.abs((g[0] + g[1]) / 2 - mid);
  const fits = gaps.filter((g) => g[1] - g[0] >= numH);
  const pick = fits.length ? fits.reduce((p, g) => (off(g) < off(p) ? g : p))
    : gaps.reduce((p, g) => (g[1] - g[0] > p[1] - p[0] ? g : p));
  const scale = fits.length ? 1 : Math.max(0.4, (pick[1] - pick[0]) / numH);
  return { top: Math.round(pick[0]), bottom: Math.round(vh - pick[1]), scale: Math.round(scale * 1000) / 1000 };
}
