// What a frame looks like, in numbers (0187). Pure functions over RGBA bytes (a screenshot's pixels),
// shared by scripts/look-audit.mjs (which runs them inside the page) and tests/unit/look-measure.test.js.
// Self-contained on purpose: look-audit passes each one's source to the page, so no imports, no closures.

// Share of the frame that reads as saturated red: the largest channel is red, HSV saturation > 0.5 and
// value > 40/255 (the critique's definition, 2026-11-10 16:00; 0086 uses the same bar on the title).
export function redShare(px, w, h) {
  let n = 0;
  const N = w * h;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = px[j], g = px[j + 1], b = px[j + 2];
    if (r <= g || r <= b || r <= 40) continue;
    const mn = g < b ? g : b;
    if ((r - mn) / r > 0.5) n++;
  }
  return N ? n / N : 0;
}

// The p-th percentile (0–100) of Rec. 709 luma (0–255) over a rect { x, y, w, h } of the frame, clipped to it.
// Null when the rect misses the frame.
export function lumaPercentile(px, w, h, rect, p) {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w)), y1 = Math.min(h, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const j = (y * w + x) * 4;
      hist[Math.round(0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2])]++;
      n++;
    }
  }
  const want = Math.max(1, Math.ceil((p / 100) * n));
  let c = 0;
  for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; }
  return 255;
}
