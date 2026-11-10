// The look's two numbers on a screenshot (0187), pure so a unit test can hold them to a synthetic image:
//   redShare: the share of pixels whose largest channel is red, with HSV saturation > 0.5 and value > 40/255
//             (the critique's definition; 0086 uses the same bar on the title).
//   lumPercentile: the p-th percentile of Rec. 709 luma (0–255, on the sRGB values) inside a rect, e.g. the
//             car's projected box: P10 ≤ 60 means a tenth of the box is dark (tyres, glass, shut lines).
// rgba: Uint8(Clamped)Array, 4 bytes a pixel, row-major; rect: { x, y, w, h } in pixels (clipped to the image).

export function isSaturatedRed(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx !== r || mx <= 40) return false;
  if (r === g && g === b) return false;   // grey: no hue, the largest channel is a tie
  return (mx - mn) / mx > 0.5;
}

function clip(rect, w, h) {
  if (!rect) return { x0: 0, y0: 0, x1: w, y1: h };
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w)), y1 = Math.min(h, Math.ceil(rect.y + rect.h));
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

export function redShare(rgba, w, h, rect = null) {
  const { x0, y0, x1, y1 } = clip(rect, w, h);
  let n = 0, red = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    n++;
    if (isSaturatedRed(rgba[i], rgba[i + 1], rgba[i + 2])) red++;
  }
  return n ? red / n : 0;
}

export function lumPercentile(rgba, w, h, rect, p) {
  const { x0, y0, x1, y1 } = clip(rect, w, h);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    hist[Math.min(255, Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]))]++;
    n++;
  }
  if (!n) return null;
  const k = Math.max(1, Math.ceil(n * p / 100));
  let s = 0;
  for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= k) return v; }
  return 255;
}
