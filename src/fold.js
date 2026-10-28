// A screen that folds (0105). Pure: everything it reads is passed in, so tests/unit/fold.test.js can
// play any device. The DOM half (readFold) only gathers the browser's answers.
//
// What a browser tells a page about a fold (docs/backlog/0102):
// - Chromium (138+, Android and desktop) reports the screen's segments (`window.viewport.segments`, one
//   DOMRect per segment) where a foldable's hinge separates them: a flip phone half-folded (Flex Mode) gives
//   two stacked segments (a horizontal fold), a book-style fold half-open two side by side (a vertical one).
//   Its Device Posture (132+) says 'folded' then; we read the media query, which is there even where
//   `navigator.devicePosture` isn't (headless Chromium 156).
// - Safari (27, measured on the simulated book-style fold) reports neither, in any pose: there a fold is
//   only a resize, and the size is all we have.

// → { split: 'none' | 'rows' | 'cols', fold: { x, y, w, h } | null, folded }
// rows: one segment above the other (a horizontal fold: the scene above, the controls below);
// cols: side by side (a vertical fold). `fold` is the band between the segments (the hinge, or 0 wide).
export function foldState({ segments = null, folded = false } = {}) {
  if (!segments || segments.length !== 2) return { split: 'none', fold: null, folded: !!folded };
  const [a, b] = segments[0].y <= segments[1].y && segments[0].x <= segments[1].x ? segments : [segments[1], segments[0]];
  if (b.y >= a.y + a.height - 1) {
    const y = a.y + a.height;
    return { split: 'rows', fold: { x: 0, y, w: Math.max(a.width, b.width), h: Math.max(0, b.y - y) }, folded: !!folded };
  }
  const x = a.x + a.width;
  return { split: 'cols', fold: { x, y: 0, w: Math.max(0, b.x - x), h: Math.max(a.height, b.height) }, folded: !!folded };
}

// The browser's answers, for foldState.
export function readFold(win = globalThis) {
  let segments = null;
  try { segments = [...(win.viewport?.segments || [])].map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })); } catch { segments = null; }
  const folded = !!win.matchMedia?.('(device-posture: folded)').matches;
  return foldState({ segments, folded });
}
