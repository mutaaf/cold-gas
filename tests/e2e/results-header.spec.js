import { test, expect } from '@playwright/test';

// Ticket 0111: the results header holds its lines on a narrow phone. At 360 px and under, `/ 100` broke
// from its number and `Perfect 10` broke at its space (the flex row let both children wrap). One flight
// (the Show reference, fast-forwarded) on a touch page at DPR 2, then the page is resized through the
// sizes and the verdict set to each string the judge can give: only the DOM is read, so the canvas isn't
// drawn. The crash's `Wrecked` is set as text, as the longest verdict is: the header lays out text.
test.slow();   // a boot and a whole flight on software GL

const PHONES = [[320, 568], [344, 882], [360, 748], [360, 380], [375, 667], [390, 844]];
const WIDE = [[1440, 900], [1280, 720], [844, 390]];
const ONE_LINE = ['Perfect 10', 'Wrecked', 'Stuck it', 'Clean', 'Contact', 'Crash'];
const LONGEST = 'Came down on the deck';

function measure(text) {
  const v = document.querySelector('[data-r-verdict]'), total = document.querySelector('.total');
  if (text != null) v.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(v);
  const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const span = total.querySelector('span'), b = total.querySelector('b');
  return {
    text: v.textContent, lines, verdict: box(v), total: box(total), num: box(b), unit: box(span),
    unitRects: span.getClientRects().length,
    verdictPx: parseFloat(getComputedStyle(v).fontSize), totalPx: parseFloat(getComputedStyle(b).fontSize),
    sheetW: document.querySelector('.results .sheet').clientWidth,
  };
}
const disjoint = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;

test('the score and the verdict hold their lines from 320 px up', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/coldgas/api/judge/stream', () => {});   // hold the theatre
  await page.goto('/coldgas/?gfx=low');
  // (physicsReady is a function: wait on it, docs/LESSONS.md.)
  await page.waitForFunction(() => window.__coldgas?.physicsReady?.(), null, { timeout: 60_000 });
  await page.evaluate(() => { const G = window.__coldgas; G.stage.render = () => {}; G.startRun('reveal'); G.skipCountdown(); G.fastForward(); });
  await page.waitForFunction(() => window.__coldgas.S.mode === 'results', null, { timeout: 60_000 });
  // The total rolls up over 1.4 s: measure the number it lands on.
  await page.waitForFunction(() => document.querySelector('[data-r-total]').textContent === window.__coldgas.S.card.total.toFixed(1), null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__coldgas.S.card.verdict)).toBe('Perfect 10');

  for (const [width, height] of [...PHONES, ...WIDE]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    for (const text of [...ONE_LINE, LONGEST]) {
      const m = await page.evaluate(measure, text);
      const at = `${width}x${height} "${text}": ${JSON.stringify(m)}`;
      // `/ 100` is one piece, beside its number (its top above the number's bottom), never under it.
      expect(m.unitRects, at).toBe(1);
      expect(m.unit.t, at).toBeLessThan(m.num.b);
      expect(m.unit.l, at).toBeGreaterThanOrEqual(m.num.r);
      expect(m.lines, at).toBeLessThanOrEqual(text === LONGEST ? 2 : 1);
      expect(disjoint(m.verdict, m.total), at).toBe(true);
      // Inside the sheet's content box, and legible.
      expect(m.total.r, at).toBeLessThanOrEqual(width + 0.5);
      expect(m.verdictPx, at).toBeGreaterThanOrEqual(18);
      expect(m.totalPx, at).toBeGreaterThanOrEqual(44);
    }
  }
  expect(errors).toEqual([]);
  await page.close();
});
